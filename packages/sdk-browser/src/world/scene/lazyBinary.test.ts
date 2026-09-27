/**
 * A session fetches the binary of the document it draws (`source.bin`) only when a path reads host
 * vertices (#876): never at load, whatever the scene's images or surfaces; once on the first read,
 * never again; and a read before it is refused by name, never answered with empty numbers.
 */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { EngineError, type ClusterManifest } from '../../../../sdk-core/src/index.ts';
import type { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts';
import { meshes } from '../../scene/meshes.ts';
import type { PageRec } from '../../page/selection/selection.ts';
import type { BlendCopy } from '../../cluster/blendCopyContract.ts';
import { loadUnpaged } from '../../webgpu/core/positions.ts';
import { folder, load, plain, serve } from './load.fixture.ts';

type Tables = {
  materials: { alphaMode: string }[];
  documents: Record<string, { images: { uri: string | null; view: number | null }[] }>;
};

/** Loads the bust, its tables through `alter`, and counts its binary's requests from then on. */
async function loaded(t: TestContext, alter = (tables: Tables) => tables, metadata = plain) {
  const asked = serve(t, (text) => JSON.stringify(alter(JSON.parse(text) as Tables)));
  const { source } = await load(metadata);
  const geometries = meshes(source).map((mesh) => mesh.geometry);
  const binaries = () => asked.filter((url) => url.endsWith('/source.bin')).length;
  return { geometries, binaries };
}

/** Every image of the document embedded in view 0, and a sidecar that bakes every one. */
async function bakedEmbedded() {
  const text = await readFile(new URL('scene-tables.json', await folder()), 'utf8');
  const count = (JSON.parse(text) as Tables).documents['source.gltf'].images.length;
  const embed = (tables: Tables) => {
    for (const image of tables.documents['source.gltf'].images)
      Object.assign(image, { uri: null, view: 0 });
    return tables;
  };
  const previews = Array.from({ length: count }, (_, image) => ({
    image,
    firstLevel: 0,
    bakedLevels: 0,
  }));
  const metadata = { primitives: [], textures: { url: 'v' }, texturePreviews: previews };
  return { embed, metadata: metadata as unknown as ClusterManifest };
}

test('a load reads no source.bin: external images, transparent surfaces, baked embedded images', async (t) => {
  assert.equal((await loaded(t)).binaries(), 0, 'opaque, external images');
  const blend = (tables: Tables) => {
    for (const material of tables.materials) material.alphaMode = 'BLEND';
    return tables;
  };
  assert.equal((await loaded(t, blend)).binaries(), 0, 'transparent surfaces');
  const { embed, metadata } = await bakedEmbedded();
  assert.equal((await loaded(t, embed, metadata)).binaries(), 0, 'baked embedded images');
});

test('the first read of loaded vertices fetches source.bin once; a second read fetches nothing', async (t) => {
  const { geometries, binaries } = await loaded(t);
  assert.ok(geometries.length > 1, 'the bust draws several meshes');
  const [first, second] = geometries;
  await Promise.all([first.loadVertices(), first.loadVertices()]);
  assert.equal(binaries(), 1);
  assert.ok(first.attributes.position.getX(0) !== undefined, 'its numbers are read');
  await second.loadVertices();
  assert.equal(binaries(), 1, 'the binary read once serves every mesh');
});

test('a synchronous read of loaded vertices before their load is refused by name', async (t) => {
  const { geometries, binaries } = await loaded(t);
  const [geometry] = geometries;
  const refused = (error: unknown) =>
    error instanceof EngineError && error.code === 'VERTICES_NOT_LOADED';
  assert.throws(() => geometry.attributes.position.array, refused);
  assert.throws(() => geometry.attributes.position.getX(0), refused);
  assert.throws(() => geometry.index!.array, refused);
  assert.ok(geometry.attributes.position.count > 0, 'the count is known before the load');
  assert.equal(binaries(), 0);
});

test('a late read of loaded vertices outlives the signal of the load that settled', async (t) => {
  const asked = serve(t);
  const control = new AbortController();
  const { source } = await load(plain, undefined, control.signal);
  control.abort();
  const [geometry] = meshes(source).map((mesh) => mesh.geometry);
  await geometry.loadVertices();
  assert.equal(asked.filter((url) => url.endsWith('/source.bin')).length, 1);
  assert.ok(geometry.attributes.position.array.length > 0, 'its vertices are loaded');
});

test('WebGPU loads host vertices only for a cluster no geometry page covers', async (t) => {
  const { geometries, binaries } = await loaded(t);
  const [paged, bare] = geometries;
  const rec = (geometry: Geometry, geometryPage: boolean) =>
    ({ geometryPage, attributes: geometry.attributes }) as unknown as PageRec;
  const copy = { geometry: paged, userData: { pageGeometry: true } } as unknown as BlendCopy;
  assert.deepEqual(await loadUnpaged([rec(paged, true)], [copy]), []);
  assert.equal(binaries(), 0, 'every cluster and copy read from pages');
  const unpaged = rec(bare, false);
  assert.deepEqual(await loadUnpaged([rec(paged, true), unpaged], [copy]), [unpaged]);
  assert.equal(binaries(), 1);
  assert.ok(bare.attributes.position.array.length > 0, 'its vertices are loaded');
});
