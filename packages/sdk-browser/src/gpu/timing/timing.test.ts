import { PART, fixture } from '../../../../../tests/kit/gpu/timingDevice.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGpuTiming } from './timing.ts';
import { QUERY_COUNT } from './queries.ts';
import { QUERY_SET_SIZE } from './encoder.ts';

test('an image spanning two encoders yields one sample whose passes carry their own duration in submission order', async () => {
  const f = fixture(),
    samples: any[] = [];
  const timer = createGpuTiming(f.device, {
    onSample(sample) {
      samples.push(sample);
    },
  });
  const selection = timer.createEncoder(1);
  selection.beginComputePass({ label: 'selection' }).end();
  selection.finish();
  const render = timer.createEncoder(1);
  render.beginRenderPass({ label: 'lighting', colorAttachments: [] }).end();
  render.finish();
  assert.equal(f.descriptors[0].timestampWrites.beginningOfPassWriteIndex, 0);
  assert.equal(f.descriptors[1].timestampWrites.beginningOfPassWriteIndex, PART);
  assert.deepEqual(f.ops, [
    'resolve 0 2 @0',
    'copy 0 -> 0 x16',
    'finish',
    'resolve ' + PART + ' 2 @' + PART * 8,
    `copy ${PART * 8} -> ${PART * 8} x16`,
    'finish',
  ]);
  assert.equal(timer.isSampled(selection), true);
  timer.submitted(render, { submission: 7 });
  await timer.flush();
  assert.equal(samples.length, 1);
  assert.equal(samples[0].frame, 1);
  assert.equal(samples[0].submission, 7);
  assert.equal(samples[0].truncated, false);
  assert.deepEqual(samples[0].passes, [
    { name: 'selection', gpuMs: 2 },
    { name: 'lighting', gpuMs: 3 },
  ]);
  assert.equal(samples[0].totalMs, 5);
  // The enclosing duration is the first beginning to the last end — 1 ms to 7 ms — of which 2 ms and
  // 3 ms are the two submissions and the remaining 1 ms is the host between them, never GPU work.
  assert.equal(samples[0].frameMs, 6);
  assert.deepEqual(samples[0].submissions, [
    { part: 0, passes: 1, spanMs: 2 },
    { part: 1, passes: 1, spanMs: 3 },
  ]);
  assert.equal(samples[0].hostGapMs, 1);
  timer.dispose();
  assert.equal(
    f.destroys(),
    Math.ceil(QUERY_COUNT / QUERY_SET_SIZE) + 2,
    'the sets and two buffers',
  );
});
test('unsupported timestamps allocate nothing and report no sample', () => {
  const f = fixture(false),
    samples: any[] = [];
  const timer = createGpuTiming(f.device, {
    onSample(sample) {
      samples.push(sample);
    },
  });
  const encoder = timer.createEncoder(1);
  encoder.beginComputePass({ label: 'plain' });
  encoder.finish();
  timer.submitted(encoder, { frame: 1 });
  assert.equal(timer.supported, false);
  assert.equal(f.buffers.length, 0);
  assert.equal(f.descriptors[0].timestampWrites, undefined);
  assert.deepEqual(samples, []);
  assert.equal(timer.stats().skippedFrames.unsupported, 1);
  timer.dispose();
});
test('missing or reversed timestamps invalidate only that pass and the next image stays measurable', async () => {
  const f = fixture(),
    samples: any[] = [];
  const timer = createGpuTiming(f.device, {
    onSample(sample) {
      samples.push(sample);
    },
  });
  const encoder = timer.createEncoder(1);
  encoder.beginComputePass({ label: 'empty' }).end();
  encoder.beginComputePass({ label: 'lighting' }).end();
  encoder.finish();
  const values = new BigUint64Array(f.buffers[1].getMappedRange());
  values[1] = 0n;
  values[2] = 4000000n;
  values[3] = 7000000n;
  timer.submitted(encoder, { frame: 1 });
  await timer.flush();
  assert.equal(samples[0].passes[0].gpuMs, null);
  assert.equal(samples[0].passes[0].reason, 'invalid-timestamps');
  assert.equal(samples[0].passes[1].gpuMs, 3);
  assert.equal(samples[0].totalMs, null);
  assert.equal(timer.supported, true);
  values[1] = 3000000n;
  const next = timer.createEncoder(61);
  next.beginComputePass({ label: 'next' }).end();
  next.finish();
  timer.submitted(next, { frame: 61 });
  await timer.flush();
  assert.equal(samples[1].totalMs, 2);
  timer.dispose();
});
test('an unsubmitted part, a busy readback and a failed mapping each leave the timing usable and counted', async () => {
  const f = fixture(),
    samples: any[] = [];
  const timer = createGpuTiming(f.device, {
    onSample(sample) {
      samples.push(sample);
    },
  });
  const orphan = timer.createEncoder(1);
  orphan.beginComputePass({ label: 'never submitted' }).end();
  const render = timer.createEncoder(1);
  render.beginComputePass({ label: 'render' }).end();
  render.finish();
  f.buffers[1].mapAsync = async () => {
    throw Error('MAP_FAILED');
  };
  timer.submitted(render, { frame: 1 });
  const busy = timer.createEncoder(61);
  busy.beginComputePass({ label: 'busy' });
  assert.equal(f.descriptors.at(-1).timestampWrites, undefined);
  await timer.flush();
  assert.equal(samples[0].totalMs, null);
  assert.equal(samples[0].truncated, true);
  assert.match(String(samples[0].error), /MAP_FAILED/);
  assert.equal(timer.supported, false);
  const stats = timer.stats();
  assert.equal(stats.unresolvedParts, 1);
  assert.equal(stats.droppedSamples, 1);
  assert.equal(stats.skippedFrames.busy, 1);
  timer.dispose();
});
test('the sampling cadence bounds how many images are measured and an observer failure never stops it', async () => {
  const f = fixture(),
    samples: any[] = [];
  const timer = createGpuTiming(f.device, {
    sampleEveryFrames: 3,
    onSample(sample) {
      samples.push(sample);
      throw new Error('OBSERVER_FAILURE');
    },
  });
  for (let frame = 0; frame < 9; frame++) {
    const encoder = timer.createEncoder(frame);
    encoder.beginComputePass({ label: 'opaque' }).end();
    encoder.finish();
    timer.submitted(encoder, { frame });
    await timer.flush();
  }
  const stats = timer.stats();
  assert.equal(samples.length, 3);
  assert.equal(stats.sampledFrames, 3);
  assert.equal(stats.completedSamples, 3);
  assert.equal(stats.skippedFrames.interval, 6);
  assert.equal(stats.pending, 0);
  timer.dispose();
});
