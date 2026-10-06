// A pass the driver skips writes no timestamps: its slots keep what they held, an earlier image's
// pair, or zero. That is no time of the image, and no reason to drop the image's own.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MS, timer } from './imageTimer.fixture.ts';

test("a pass the driver skipped keeps an older image's pair: no time, and the image stays whole", async () => {
  // Image 2's second pass is empty: its slots still hold image 1's pair, long before. Read as
  // a time, the image would span the gap between them on a short frame.
  const { f, timing, samples, image } = timer();
  image(1, [
    [1000, 1004],
    [1005, 1010],
  ]);
  await timing.flush();
  image(2, [
    [1800, 1804],
    [1805, 1810],
  ]);
  new BigUint64Array(f.buffers[1].getMappedRange()).set([1005n * MS, 1010n * MS], 2);
  await timing.flush();
  const sample = samples[1];
  assert.equal(sample.frameMs, 4);
  assert.equal(sample.submittedMs, 4);
  assert.equal(sample.totalMs, null, 'a sum of passes holds none for a pass without a time');
  assert.deepEqual(sample.passes, [
    { name: 'pass', gpuMs: 4, ownMs: 4 },
    { name: 'pass', gpuMs: null, reason: 'unwritten-timestamps' },
  ]);
  assert.equal(timing.stats().invalidSamples, 0, 'a skipped pass is not an invalid reading');
  timing.dispose();
});

test('a slot no image ever wrote reads zero, a skipped pass too; an image none of whose passes ran has no time', async () => {
  const { f, timing, samples, image } = timer();
  image(1, [
    [1000, 1004],
    [1005, 1010],
  ]);
  new BigUint64Array(f.buffers[1].getMappedRange()).set([0n, 0n], 2);
  await timing.flush();
  assert.equal(samples[0].frameMs, 4);
  image(2, [
    [1100, 1104],
    [1105, 1110],
  ]);
  new BigUint64Array(f.buffers[1].getMappedRange()).set([1000n * MS, 1004n * MS, 0n, 0n]);
  await timing.flush();
  assert.equal(samples[1].frameMs, null);
  assert.equal(samples[1].submittedMs, null);
  timing.dispose();
});

test('a pass the device began before the previous image ended is a time, not a stale slot', async () => {
  // A tiled device begins a render pass at its vertex stage (`sample.ts`): the next image's first
  // pass starts while the last one's tail runs. Its pair is new, whatever the order of the images.
  const { timing, samples, image } = timer();
  image(1, [
    [1000, 1004],
    [1005, 1010],
  ]);
  await timing.flush();
  image(2, [
    [1008, 1012],
    [1009, 1014],
  ]);
  await timing.flush();
  const sample = samples[1];
  assert.equal(sample.frameMs, 6);
  assert.equal(sample.submittedMs, 6);
  assert.deepEqual(
    sample.passes.map((pass) => pass.gpuMs),
    [4, 5],
  );
  assert.equal(sample.idleBetweenMs, null, 'the timeline went backwards: no idle to publish');
  timing.dispose();
});

test("a readback landing after a later image's compares nothing: its pair is its own", async () => {
  const { f, timing, samples, image } = timer();
  const first = timing.createEncoder(1);
  first.beginComputePass({ label: 'pass' }).end();
  first.finish();
  new BigUint64Array(f.buffers[1].getMappedRange()).set([1000n * MS, 1004n * MS]);
  let land = () => {};
  f.buffers[1].mapAsync = () => new Promise<void>((resolve) => void (land = resolve));
  timing.submitted(first, { frame: 1 });
  // Image 2 reads first; the slot it shares holds the pair of image 1, not yet read.
  image(2, [[1000, 1004]]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  land();
  await timing.flush();
  assert.deepEqual(
    samples.map((sample) => [sample.frame, sample.frameMs]),
    [
      [2, 4],
      [1, 4],
    ],
  );
  timing.dispose();
});
