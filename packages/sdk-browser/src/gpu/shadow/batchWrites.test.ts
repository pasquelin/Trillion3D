// The writes of a frame's shadow batches (#489): the first batch writes straight, as a single batch
// always did; while staged, each write lands in the frame's command order — a staging slot of its
// own and a copy into its target —, so a later batch never overwrites an earlier one before it ran.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDevice, written } from '../../../../../tests/kit/gpu/fakeDevice.ts';
import { shadowBatchWrites } from './batchWrites.ts';
import {
  MAX_SHADOW_BATCHES,
  SHADOW_BATCH_WRITE_BYTES,
  SHADOW_STAGING_BYTES,
} from './batchBudget.ts';

test('unstaged, a write goes straight to its target', () => {
  const { device, writes, copies } = fakeDevice();
  const target = device.createBuffer({ size: 16, usage: 0 });
  shadowBatchWrites(device).write(target, 4, Uint32Array.of(1, 2, 3), 1, 2);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].buffer, target);
  assert.deepEqual([...written(writes[0])], [2, 3]);
  assert.equal(copies.length, 0);
});

test('staged, two batches writing one buffer each land in command order', () => {
  const { device, writes, copies } = fakeDevice();
  const target = device.createBuffer({ size: 16, usage: 0 }),
    encoder = device.createCommandEncoder(),
    batches = shadowBatchWrites(device);
  batches.stage(encoder);
  batches.write(target, 0, Uint32Array.of(7, 8));
  batches.write(target, 0, Uint32Array.of(9, 10));
  batches.end();
  assert.equal(writes.length, 2);
  const [first, second] = writes;
  assert.notEqual(first.buffer, target, 'staged apart');
  assert.deepEqual([first.offset, second.offset], [0, 8], 'each its own slot');
  assert.deepEqual([...written(first), ...written(second)], [7, 8, 9, 10]);
  assert.deepEqual(
    copies.map(({ fromOffset, to, toOffset, size }) => [fromOffset, to, toOffset, size]),
    [
      [0, target, 0, 8],
      [8, target, 0, 8],
    ],
    'copied into the target in the order written',
  );
});

// The staging buffer is sized once, from the most batches a frame draws (`batchBudget.ts`), and
// counted in the memory budget: the largest frame fits it, and nothing is made at run time.
test('the staging buffer is made once, at its largest, and holds the largest frame', () => {
  const { device, buffers } = fakeDevice();
  const target = device.createBuffer({ size: SHADOW_BATCH_WRITE_BYTES, usage: 0 }),
    batches = shadowBatchWrites(device),
    batch = new Uint32Array(SHADOW_BATCH_WRITE_BYTES / 4);
  for (let frame = 0; frame < 2; frame++) {
    for (let k = 1; k < MAX_SHADOW_BATCHES; k++) {
      batches.stage(device.createCommandEncoder());
      batches.write(target, 0, batch);
    }
    batches.end();
  }
  const staging = buffers.filter((buffer) => buffer !== target);
  assert.deepEqual(
    staging.map(({ size }) => size),
    [SHADOW_STAGING_BYTES],
    'one buffer, for every batch of the largest frame but the first',
  );
  batches.stage(device.createCommandEncoder());
  batches.write(target, 0, batch);
  assert.throws(() => batches.write(target, 0, Uint32Array.of(1)), /SHADOW_BATCH_WRITES_OVERFLOW/);
  batches.end();
});
