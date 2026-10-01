// #1335: the per-mesh atlas feed holds the card atlases on the GPU within the room the one texture
// budget leaves them: the atlas drawn least recently leaves for a new one, an atlas this frame
// draws never does, an atlas past the room is never read, and one the device refuses is reported
// and leaves its mesh to its clusters. Fails on develop: `feed.ts` is not there.
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
const settle = () => new Promise((resolve) => setImmediate(resolve));

function feedOf(room: number, refuse?: Parameters<typeof fakeDevice>[0]) {
  const gpu = fakeDevice(refuse);
  const asked: string[] = [],
    failed: string[] = [];
  const reader = (async ({ url }: { url: string }) => {
    asked.push(url);
    return { width: 8, height: 8, close() {} };
  }) as unknown as TextureLevelReader;
  const feed = createImpostorFeed(gpu.device, {} as GPUBindGroupLayout, reader, {
    room: () => room,
    landed: () => undefined,
    onFailure: (phase) => failed.push(phase),
  });
  /** Asks `mesh` at `frame` until its levels land and its atlas is made: its group then. */
  const resident = async (mesh: number, frame: number) => {
    feed.group(mesh, mapsOf(mesh), frame);
    await settle();
    feed.group(mesh, mapsOf(mesh), frame);
    await settle();
    return feed.group(mesh, mapsOf(mesh), frame);
  };
  return { gpu, feed, asked, failed, resident };
}

test('within the room, the atlas drawn least recently leaves for a new one', async () => {
  const { gpu, feed, resident } = feedOf(ATLAS_BYTES);
  assert.equal(feed.group(1, mapsOf(1), 0), undefined, 'asked, not yet resident');
  assert.ok(await resident(1, 0), 'mesh 1 resident');
  assert.ok(await resident(2, 1), 'mesh 2 took the place of mesh 1, not drawn this frame');
  assert.equal(feed.bytes, ATLAS_BYTES);
  assert.equal(gpu.destroyed.length, 3, "mesh 1's three textures released");
});

test('an atlas the frame draws stays, and one that cannot fit leaves its mesh whole', async () => {
  const { feed, resident } = feedOf(ATLAS_BYTES);
  const drawn = await resident(1, 0);
  feed.group(1, mapsOf(1), 1);
  assert.equal(await resident(2, 1), undefined, 'mesh 2 keeps its clusters');
  assert.equal(feed.group(1, mapsOf(1), 1), drawn, 'the drawn atlas stays');
  assert.equal(feed.bytes, ATLAS_BYTES);
});

test('an atlas past the room is never read, one the device refuses is reported', async () => {
  const small = feedOf(ATLAS_BYTES - 1);
  assert.equal(await small.resident(1, 0), undefined);
  assert.deepEqual(small.asked, [], 'nothing read for an atlas that cannot fit');
  const refused = feedOf(ATLAS_BYTES, { refuse: () => 'oom' });
  assert.equal(await refused.resident(1, 0), undefined, 'the mesh keeps its clusters');
  assert.deepEqual(refused.failed, ['gpu-out-of-memory']);
  assert.equal(refused.feed.bytes, 0, 'its bytes given back');
});
