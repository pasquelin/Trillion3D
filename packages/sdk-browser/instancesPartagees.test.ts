import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { dagFixture } from './pageSelectionDagFixture.ts';
import { collectClusterPages } from './pageSelection.ts';
import { createPrimitiveTemplates } from './pageSelectionTemplate.ts';
import {
  dropBlendBuffers,
  ensureBlendIndexBuffer,
  ensureBlendNormalBuffer,
  ensureBlendUvBuffer,
} from './webgpuBlendBuffers.ts';
import { createWebgpuGpuState } from './webgpuPagesStateGpu.ts';
import type { ClusterManifest, Primitive } from '../sdk-core/index.ts';

/** Un appareil qui ne sait que créer des tampons et compter ce qu'on y écrit. */
function fakeDevice() {
  Object.assign(globalThis, { GPUBufferUsage: { COPY_DST: 8, STORAGE: 128 } });
  const created: Array<{ size: number; writes: number; destroyed: number }> = [];
  const device = {
    createBuffer({ size }: { size: number }) {
      const entry = { size, writes: 0, destroyed: 0 };
      created.push(entry);
      return { size, destroy: () => entry.destroyed++, entry } as unknown as GPUBuffer;
    },
    queue: {
      writeBuffer(buffer: GPUBuffer) {
        (buffer as unknown as { entry: { writes: number } }).entry.writes++;
      },
    },
  } as unknown as GPUDevice;
  return { device, created };
}

function blendGeometry(withUv: boolean) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
  );
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  if (withUv) geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
  geometry.setIndex([0, 1, 2]);
  return geometry;
}

// Comportement : les tampons d'indices, d'UV et de normales d'un transparent appartiennent à la
// géométrie. Deux placements de la même géométrie les partagent, chacun n'est écrit qu'une fois et
// n'est compté qu'une fois dans `vertexBytes`.
test('deux placements d’une même géométrie transparente partagent indices, UV et normales', () => {
  const { device, created } = fakeDevice();
  const gpu = createWebgpuGpuState([1, 1]);
  const shared = blendGeometry(true),
    other = blendGeometry(true);
  const index = shared.getIndex()!;
  const first = {
    index: ensureBlendIndexBuffer(device, index, gpu),
    uv: ensureBlendUvBuffer(device, shared.attributes, gpu),
    normal: ensureBlendNormalBuffer(device, shared.attributes, gpu),
  };
  const second = {
    index: ensureBlendIndexBuffer(device, index, gpu),
    uv: ensureBlendUvBuffer(device, shared.attributes, gpu),
    normal: ensureBlendNormalBuffer(device, shared.attributes, gpu),
  };
  assert.equal(second.index, first.index);
  assert.equal(second.uv, first.uv);
  assert.equal(second.normal, first.normal);
  assert.equal(created.length, 3);
  for (const entry of created) assert.equal(entry.writes, 1);
  const bytesOnce = gpu.vertexBytes;
  assert.equal(
    bytesOnce,
    created.reduce((total, entry) => total + entry.size, 0),
  );
  // Une autre géométrie garde les siens.
  ensureBlendIndexBuffer(device, other.getIndex()!, gpu);
  ensureBlendUvBuffer(device, other.attributes, gpu);
  ensureBlendNormalBuffer(device, other.attributes, gpu);
  assert.equal(created.length, 6);
  assert.ok(gpu.vertexBytes > bytesOnce);
  dropBlendBuffers(gpu);
  for (const entry of created) assert.equal(entry.destroyed, 1);
  assert.equal(gpu.blendIndexBuffers.size, 0);
  assert.equal(gpu.blendUvBuffers.size, 0);
  assert.equal(gpu.blendNormalBuffers.size, 0);
});

// Comportement : une géométrie sans UV n'en fabrique jamais, et l'absence est retenue — le second
// placement ne relance pas la recherche et n'alloue rien.
test('une géométrie transparente sans UV rend `undefined`, une seule fois', () => {
  const { device, created } = fakeDevice();
  const gpu = createWebgpuGpuState([1, 1]);
  const geometry = blendGeometry(false);
  assert.equal(ensureBlendUvBuffer(device, geometry.attributes, gpu), undefined);
  assert.equal(ensureBlendUvBuffer(device, geometry.attributes, gpu), undefined);
  assert.equal(created.length, 0);
  assert.equal(gpu.blendUvBuffers.size, 1);
});

/** La même primitive, dotée d'une hiérarchie de culling à un nœud feuille. */
function primitiveWithCulling(metadata: ClusterManifest) {
  const primitive = metadata.primitives[0] as Primitive & {
    culling: { version: number; count: number; stride: number; nodes: number[] };
  };
  primitive.culling = {
    version: 1,
    count: 1,
    stride: 15,
    nodes: [-2, -0.5, 0, 2, 0.5, 0, 0, 0, 0, 2.3, 0.2, 0, 0, 0, primitive.pages.length],
  };
  return primitive;
}

// Comportement : un gabarit par primitive. Deux appels rendent les mêmes pages, la même hiérarchie
// et les mêmes bornes, et la couverture n'est vérifiée qu'une fois par tableau d'indices source.
test('le gabarit d’une primitive est calculé une fois et rendu tel quel au placement suivant', () => {
  const fixture = dagFixture();
  const primitive = primitiveWithCulling(fixture.metadata);
  const templates = createPrimitiveTemplates(fixture.indices, false);
  const first = templates.pagesOf(primitive),
    second = templates.pagesOf(primitive);
  assert.equal(second, first);
  const src = fixture.geometry.getIndex()!.array as ArrayLike<number>;
  templates.checkCoverage(primitive, first, src);
  assert.equal(first.checked, src);
  const shape = templates.shapeOf(primitive, first);
  assert.equal(templates.shapeOf(primitive, second), shape);
  assert.ok(shape.culling && shape.bounds);
  // Une couverture qui ne correspond pas est refusée, même après un gabarit déjà vérifié.
  assert.throws(() => templates.checkCoverage(primitive, first, new Uint32Array([0, 1, 2])), {
    message: 'Incomplete cluster coverage',
  });
});

// Comportement : deux instances d'un objet partagent la forme de son DAG — hiérarchie, bornes par
// nœud, liens de groupes, identités de clusters — et ne partagent rien de ce qui les distingue :
// matrice monde, boîte monde, drapeaux de groupes forcés, enregistrements de pages.
test('deux instances partagent la forme du DAG, jamais ce qui les place', () => {
  const fixture = dagFixture();
  primitiveWithCulling(fixture.metadata);
  const second = new THREE.Mesh(fixture.mesh.geometry, fixture.mesh.material);
  second.position.set(50, 0, 0);
  fixture.source.add(second);
  fixture.associations.set(second, { meshes: 0, primitives: 0 });
  const { roots, allPages } = collectClusterPages(
    fixture.source,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
  );
  assert.equal(roots.length, 2);
  assert.equal(allPages.length, roots[0].pages.length * 2);
  assert.equal(roots[0].culling!.nodes, roots[1].culling!.nodes);
  assert.equal(roots[0].culling!.bounds, roots[1].culling!.bounds);
  assert.equal(roots[0].structure, roots[1].structure);
  assert.notEqual(roots[0].forced, roots[1].forced);
  assert.notEqual(roots[0].localBox, roots[1].localBox);
  assert.deepEqual(roots[0].localBox.min.toArray(), roots[1].localBox.min.toArray());
  assert.notEqual(roots[0].world, roots[1].world);
  assert.notDeepEqual(roots[0].worldBox.min.toArray(), roots[1].worldBox.min.toArray());
  for (let i = 0; i < roots[0].pages.length; i++) {
    const a = roots[0].pages[i],
      b = roots[1].pages[i];
    assert.notEqual(a, b);
    // L'identité d'un cluster est celle de la primitive : une seule chaîne pour tous ses placements.
    assert.equal(a.clusterId, b.clusterId);
    assert.equal(a.sphere, b.sphere);
    assert.equal(a.lodError, b.lodError);
    assert.notEqual(a.matrix, b.matrix);
  }
});
