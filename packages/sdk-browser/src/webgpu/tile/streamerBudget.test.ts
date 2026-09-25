// The tile pass stops copying once its millisecond budget is spent and defers the rest to the
// next pass, most looked-at first; a barrier lifts the budget; the worst budgeted pass is kept.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebgpuTileStreamer } from './streamer.ts';
import { poolEncoding } from '../../texture/blockFormats.ts';
import { levelSize, tileLayout } from '../../texture/tiles.ts';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';

/** Milliseconds each fake copy costs on the test's own clock — the budget is read on it — and
 *  what the shadows that follow the landed colour tiles cost after the last copy. */
const COPY_MS = 2,
  FOLLOW_MS = 1;

/** The device of the pass: each image copy costs `COPY_MS` on the test's clock, and each colour
 *  signal `FOLLOW_MS` after it; a readback buffer gives back what the test wrote in it. */
function tileDevice() {
  const { device, buffers, imageCopies } = fakeDevice();
  let follows = 0;
  return {
    device,
    staging: buffers,
    copies: () => imageCopies.length,
    now: () => imageCopies.length * COPY_MS + follows * FOLLOW_MS,
    follow: () => void follows++,
  };
}

/** One baked 256² colour texture: four level-0 tiles and one level-1 tile to stream. */
function streamer(budgetMs: number) {
  const { device, staging, copies, now, follow } = tileDevice();
  const layout = tileLayout(256, 256);
  const tail: Uint8Array<ArrayBuffer>[] = [];
  for (let level = layout.tail; level <= layout.last; level++) {
    const [w, h] = levelSize(256, 256, level);
    tail.push(new Uint8Array(w * h * 4));
  }
  const blocks = { bc7: [], astc: [] };
  const fill = {
    layout: tileLayout(1, 1),
    lane: 'lossless' as const,
    source: { kind: 'bytes' as const, tail: { levels: [new Uint8Array(4)], blocks } },
  };
  const sha256 = 'a'.repeat(64);
  const lossless = { lossless: 1, rgba: 0, 'two-channel': 0 };
  const textures = createWebgpuTileStreamer({
    device,
    color: [
      fill,
      {
        layout,
        lane: 'lossless',
        source: { kind: 'baked', sha256, atlas: 0, tail: { levels: tail, blocks } },
      },
    ],
    data: [fill],
    layers: { color: lossless, data: lossless },
    encoding: poolEncoding(undefined),
    budgetBytes: Number.MAX_SAFE_INTEGER,
    budgetMs,
    now,
    readLevel: async ({ level }) => {
      const [width, height] = levelSize(256, 256, level);
      return { width, height, close() {} } as ImageBitmap;
    },
    onFailure: (phase, error) => assert.fail(`${phase}: ${String(error)}`),
    onColorChanged: follow,
  });
  textures.prepare();
  /** Image feedback that names every streamed tile, heaviest first: the next pass takes it. */
  const feed = async () => {
    textures.feedback.encode(device.createCommandEncoder());
    const readback = staging.filter((b) =>
      b.label?.startsWith('Trillion3D texture feedback readback'),
    );
    for (const buffer of readback)
      new Uint32Array(buffer.getMappedRange()).set([5, 4, 3, 2, 1].slice(0, layout.entries));
    textures.feedback.submitted();
    await textures.settled();
  };
  return { textures, feed, copies };
}

test('a pass copies until its millisecond budget is spent, then defers the rest to the next passes', async () => {
  const { textures, feed, copies } = streamer(1.5 * COPY_MS);
  assert.equal(textures.metrics().textureUploadPeakMs, null, 'no pass yet: unmeasured');
  await feed();
  // First pass: the levels are not decoded yet, nothing is copied, the reads are launched.
  assert.deepEqual(textures.pump(1), { served: 0, pending: 5 });
  await textures.settled();
  await feed();
  // One copy fits under the budget, the second closes it: two served, three deferred.
  assert.deepEqual(textures.pump(2), { served: 2, pending: 3 });
  assert.equal(copies(), 2);
  const metrics = textures.metrics();
  assert.equal(metrics.textureTilesDeferred, 3);
  assert.equal(metrics.textureTilesPending, 3);
  assert.equal(
    metrics.textureUploadPeakMs,
    2 * COPY_MS + FOLLOW_MS,
    'the peak is the pass that was measured, the shadow follow included',
  );
  assert.equal(metrics.textureUploadMs, 2 * COPY_MS + FOLLOW_MS);
  // No fresh feedback: the deferred tiles are served from the backlog, budget after budget.
  assert.deepEqual(textures.pump(3), { served: 2, pending: 1 });
  assert.deepEqual(textures.pump(4), { served: 1, pending: 0 });
  assert.equal(textures.metrics().textureTilesDeferred, 0);
  assert.equal(copies(), 5);
  // Nothing named, nothing deferred: the pass does no work and costs nothing measurable.
  assert.deepEqual(textures.pump(5), { served: 0, pending: 0 });
  assert.equal(textures.counters.worked, false);
  assert.equal(textures.metrics().textureUploadMs, null);
});

test('a zero budget still lands one tile per pass, and a barrier lifts the budget without moving the peak', async () => {
  const { textures, feed, copies } = streamer(0);
  await feed();
  textures.pump(1);
  await textures.settled();
  await feed();
  assert.deepEqual(textures.pump(2), { served: 1, pending: 4 });
  const peak = textures.metrics().textureUploadPeakMs;
  assert.deepEqual(textures.pump(3, true), { served: 4, pending: 0 });
  assert.equal(copies(), 5);
  assert.equal(textures.metrics().textureUploadPeakMs, peak, 'an unbounded pass is not a frame');
  assert.equal(textures.metrics().textureUploadMs, null, 'nor is it a last pass');
});
