// The import boundary's own contract: what a texture record keeps between two reads, and when it
// is refilled. Everything downstream — atlas layers, preview ranks, lane pools, the WebGL2 binder
// — addresses a texture by the identity of its record and reads the UV transform it holds, so the
// identity, the refill at the next image and the aliased transform are the boundary's promises.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import * as G from './graph/graph.fixture.ts';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { importHostSurface } from './surfaceImport.ts';
import { followHostTexture, importHostTexture } from './textureImport.ts';

const texture = () => {
  const map = G.dataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1, G.HOST_FORMAT_RGBA);
  map.needsUpdate = true;
  return map;
};

test('One host texture keeps one record for the session', () => {
  const host = texture();
  const first = importHostTexture(host);
  assert.equal(importHostTexture(host), first, 'a second read returns the held record');
  const surface = importHostSurface(G.standardSurface({ map: host }));
  assert.equal(surface?.map, first, 'a surface reads the same record as a direct import');
});

test('A version bump refills the held record at the next follow, its counters with it', () => {
  const host = texture();
  const record = importHostTexture(host);
  const { version, sampling, placement } = record;
  assert.equal(record.wrapS, 'clamp');
  host.wrapS = G.HOST_WRAP_REPEAT;
  host.anisotropy = 4;
  host.needsUpdate = true;
  followHostTexture(record);
  assert.equal(importHostTexture(host), record, 'the record the pools address keeps its identity');
  assert.equal(record.wrapS, 'repeat');
  assert.equal(record.anisotropy, 4);
  assert.equal(record.version, version + 1, 'the picture is sent again');
  assert.equal(record.sampling, sampling + 1, 'the sampler is set again');
  assert.equal(record.placement, placement, 'nothing placed again');
  followHostTexture(record);
  assert.deepEqual(
    [record.version, record.sampling, record.placement],
    [version + 1, sampling + 1, placement],
    'nothing moved since',
  );
});

// Review of #389: two engines draw the same record. Its counters are monotonic and each consumer
// keeps the ones it last read, so the second engine to follow learns the change the first one
// brought up; a second render in the same task reads what was written between the two.
test('Every render follows its records, and every consumer reads what moved', () => {
  const host = texture();
  const record = importHostTexture(host);
  const seenBy = [record.sampling, record.sampling];
  host.magFilter = G.HOST_FILTER_LINEAR;
  followHostTexture(record);
  assert.ok(record.sampling > seenBy[0], 'the first engine sees it');
  seenBy[0] = record.sampling;
  followHostTexture(record);
  assert.ok(record.sampling > seenBy[1], 'the second engine too');
  assert.equal(record.sampling, seenBy[0], 'nothing moved since: counted once');
  host.wrapS = G.HOST_WRAP_REPEAT;
  host.image = { data: new Uint8Array(4), width: 1, height: 1 };
  const { version } = record;
  followHostTexture(record);
  assert.equal(record.wrapS, 'repeat', 'a second render in the same task reads it');
  assert.equal(record.version, version + 1, 'and the new image');
});

// Review of #389: what reads a record outside a render — the tile catalogue at prepare, the CPU
// twins of the raster — takes it from the import, which hands it back with the host's picture.
test('A held record is handed back with the image its host holds now', () => {
  const host = texture();
  const record = importHostTexture(host);
  const { version, placement } = record;
  host.image = { data: new Uint8Array(4), width: 1, height: 1 };
  assert.equal(importHostTexture(host), record, 'the same record');
  assert.deepEqual([record.image, record.version], [host.image, version + 1], 'its image');
  host.needsUpdate = true;
  importHostTexture(host);
  importHostTexture(host);
  assert.equal(record.version, version + 2, 'a version read, once');
  host.offset.set(0.5, 0);
  importHostTexture(host);
  assert.deepEqual([record.transform[6], record.placement], [0, placement], 'no recomposition');
});

// Review of #389: a host that disposes of a texture it still draws — Three uploads it again at
// its next use — keeps one record, followed as before, its picture to send again.
test('A disposed texture keeps its record, followed, its picture sent again', () => {
  const host = new THREE.DataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
  host.needsUpdate = true;
  const record = importHostTexture(host);
  const { version } = record;
  host.dispose();
  assert.equal(importHostTexture(host), record, 'no second record at the reimport');
  followHostTexture(record);
  assert.equal(record.version, version + 1, 'the picture is sent again');
  host.wrapT = THREE.MirroredRepeatWrapping;
  followHostTexture(record);
  assert.equal(record.wrapT, 'mirror', 'still followed');
  assert.equal(record.version, version + 1, 'sent once');
});

test('The record aliases the composed UV transform, so a later recomposition is read', () => {
  const host = texture();
  const record = importHostTexture(host);
  const same = (message: string) =>
    assert.deepEqual(Array.from(record.transform), [...host.matrix.elements], message);
  same('composed once at import');
  host.offset.set(0.25, 0.5);
  host.updateMatrix();
  same('the held record reads the recomposition without a re-import');
  assert.notEqual(record.transform[6], 0, 'the offset reached the transform');
});

// #360: a host animates a placement the way Three lets it — repeat, offset or rotation written,
// the texture's version untouched —: the matrix is recomposed at the next image, as the host's own
// renderer recomposes it at every draw, and only then: a texture that stays put is not recomposed.
test('A placement written without a version is recomposed at the next follow, only then', () => {
  const host = texture();
  const record = importHostTexture(host);
  const { version, sampling, placement } = record;
  let composed = 0;
  const updateMatrix = host.updateMatrix.bind(host);
  host.updateMatrix = () => (composed++, updateMatrix());
  followHostTexture(record);
  assert.equal(composed, 0, 'nothing moved, nothing recomposed');
  host.offset.set(0.25, 0.5);
  host.rotation = Math.PI / 2;
  followHostTexture(record);
  assert.equal(composed, 1);
  assert.deepEqual([record.version, record.sampling], [version, sampling], 'nothing sent again');
  assert.equal(record.placement, placement + 1);
  assert.deepEqual([record.transform[6], record.transform[7]], [0.25, 0.5]);
  assert.ok(Math.abs(record.transform[0]) < 1e-9, 'the quarter turn read');
  host.matrixAutoUpdate = false;
  host.matrix.elements[6] = 0.75;
  followHostTexture(record);
  assert.equal(record.placement, placement + 2, 'a matrix the page owns, read as it stands');
  followHostTexture(record);
  assert.equal(record.placement, placement + 2, 'and only when it moved');
});

// #360: `KHR_texture_transform` is applied by the loader to the texture's offset, repeat and
// rotation, never composed: the first import composes it, since the load check reads the
// transform before any image (`../scene/tables.ts`, `materialDivergence`).
test('A glTF texture transform is composed at the first import', async () => {
  const gltf = JSON.stringify({
    asset: { version: '2.0' },
    extensionsUsed: ['KHR_texture_transform'],
    textures: [{ source: 0 }],
    images: [{ uri: 'unread.png' }],
    materials: [
      {
        pbrMetallicRoughness: {
          baseColorTexture: {
            index: 0,
            extensions: {
              KHR_texture_transform: { offset: [0.25, 0.5], scale: [2, 3], rotation: 0.5 },
            },
          },
        },
      },
    ],
  });
  const loader = new GLTFLoader().register(() => ({
    name: 'fixture-image',
    loadTexture: () => Promise.resolve(new THREE.DataTexture(new Uint8Array(4), 1, 1)),
  }));
  const { parser } = await loader.parseAsync(gltf, '');
  const material = (await parser.getDependency('material', 0)) as THREE.MeshStandardMaterial;
  const expected = new THREE.Matrix3().setUvTransform(0.25, 0.5, 2, 3, 0.5, 0, 0).elements;
  const record = importHostSurface(material)!.map!;
  for (const i of [0, 1, 3, 4, 6, 7]) assert.ok(Math.abs(record.transform[i] - expected[i]) < 1e-9);
});

test('A material is read in one place, and never cached: a replaced map is seen as it stands', () => {
  const material = G.standardSurface({ map: texture() });
  assert.equal(importHostSurface(material)?.map, importHostTexture(material.map as G.GraphTexture));
  const second = texture();
  material.map = second;
  assert.equal(importHostSurface(material)?.map, importHostTexture(second));
});

// #360, #361: Three's order as often as the other — `needsUpdate`, then the filter —: nothing is
// read at `needsUpdate`, the record is brought up at the next image, the filter with it.
test('A filter written after needsUpdate reaches the record at the next image', () => {
  const host = texture();
  const record = importHostTexture(host);
  host.needsUpdate = true;
  host.magFilter = G.HOST_FILTER_LINEAR;
  assert.equal(record.magFilter, 'nearest', 'nothing read at needsUpdate');
  const { version } = record;
  followHostTexture(record);
  assert.equal(record.magFilter, 'linear');
  assert.equal(record.version, version + 1);
});
