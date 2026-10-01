// #1335: the per-mesh atlas feed holds the card atlases on the GPU within a fixed budget, as the
// reference streams impostor textures into a pool of fixed size: the atlas drawn least recently
// leaves for a new one, an atlas this frame draws never does, and a mesh whose atlas cannot fit
// keeps its clusters. Fails on develop: `feed.ts` is not there.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';
import type { ImpostorMaps } from '../../../../sdk-core/src/index.ts';
import type { TextureLevelReader } from '../../texture/levelReader.ts';
import { createImpostorFeed } from './feed.ts';

/** One mesh's maps, one 8×8 level each: 3 × 256 bytes on the GPU. */
const mapsOf = (mesh: number): ImpostorMaps => {
  const map = (kind: string, k: number) => ({
    kind,
    levels: [{ url: `${mesh}-${k}.png`, sha256: `${mesh}${k}`, bytes: 1, width: 8, height: 8 }],
  });
  return { colourCoverage: map('coverage', 0), normalDepth: map('data', 1), orm: map('data', 2) };
};
const ATLAS_BYTES = 3 * 8 * 8 * 4;
const reader = (async () => ({ width: 8, height: 8, close() {} })) as unknown as TextureLevelReader;
const settle = () => new Promise((resolve) => setImmediate(resolve));

function feedOf(budget: number) {
  const gpu = fakeDevice();
  const layout = {} as GPUBindGroupLayout;
  return { gpu, feed: createImpostorFeed(gpu.device, layout, reader, () => undefined, budget) };
}

test('within the budget, the atlas drawn least recently leaves for a new one', async () => {
  const { gpu, feed } = feedOf(ATLAS_BYTES);
  assert.equal(feed.group(1, mapsOf(1)), undefined, 'asked, not yet resident');
  await settle();
  assert.ok(feed.group(1, mapsOf(1)), 'mesh 1 resident');
  feed.beginFrame();
  feed.group(2, mapsOf(2));
  await settle();
  assert.ok(feed.group(2, mapsOf(2)), 'mesh 2 took the place of mesh 1, not drawn this frame');
  assert.equal(feed.bytes, ATLAS_BYTES);
  assert.equal(gpu.destroyed.length, 3, "mesh 1's three textures released");
});

test('an atlas the frame draws stays, and the one that cannot fit leaves its mesh whole', async () => {
  const { feed } = feedOf(ATLAS_BYTES);
  feed.group(1, mapsOf(1));
  await settle();
  feed.beginFrame();
  const drawn = feed.group(1, mapsOf(1));
  feed.group(2, mapsOf(2));
  await settle();
  assert.equal(feed.group(1, mapsOf(1)), drawn, 'the drawn atlas stays');
  assert.equal(feed.group(2, mapsOf(2)), undefined, 'mesh 2 keeps its clusters');
  assert.equal(feed.bytes, ATLAS_BYTES);
});
