// The writes of a frame's shadow batches (#489): the first batch writes straight, as a single batch
// always did; while staged, each write lands in the frame's command order — a staging slot of its
// own and a copy into its target —, so a later batch never overwrites an earlier one before it ran.
// The staged words reach the GPU in one upload per frame, whatever its batches (#344), not one
// `writeBuffer` per staged write.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDevice, written } from '../../../../../tests/kit/gpu/fakeDevice.ts';
import { shadowBatchWrites } from './batchWrites.ts';
import { MAX_SHADOW_PAGES } from './recordPack.ts';
import {
  MAX_SHADOW_BATCHES,
  SHADOW_BATCH_WRITE_BYTES,
  SHADOW_STAGING_BYTES,
  shadowBatchCapacity,
} from './batchBudget.ts';

test('unstaged, a write goes straight to its target', () => {
  const { device, writes, copies } = fakeDevice();
  const target = device.createBuffer({ size: 16, usage: 0 });
  const batches = shadowBatchWrites(device);
  batches.write(target, 4, Uint32Array.of(1, 2, 3), 1, 2);
  batches.end();
  assert.equal(writes.length, 1, 'a frame of one batch uploads nothing more');
  assert.equal(writes[0].buffer, target);
  assert.deepEqual([...written(writes[0])], [2, 3]);
  assert.equal(copies.length, 0);
});

test('staged, two batches writing one buffer each land in command order', () => {
  const { device, writes, copies } = fakeDevice();
  const target = device.createBuffer({ size: 16, usage: 0 }),
    encoder = device.createCommandEncoder(),
    batches = shadowBatchWrites(device);
  batches.reserve(SHADOW_BATCH_WRITE_BYTES);
  batches.stage(encoder);
  batches.write(target, 0, Uint32Array.of(7, 8));
  batches.write(target, 0, Uint32Array.of(9, 10));
  assert.equal(writes.length, 0, 'nothing uploaded before the batches end');
  batches.end();
  assert.equal(writes.length, 1, 'one upload');
  const [upload] = writes;
  assert.notEqual(upload.buffer, target, 'staged apart');
  assert.equal(upload.offset, 0);
  assert.deepEqual([...written(upload)], [7, 8, 9, 10]);
  assert.deepEqual(
    copies.map(({ fromOffset, to, toOffset, size }) => [fromOffset, to, toOffset, size]),
    [
      [0, target, 0, 8],
      [8, target, 0, 8],
    ],
    'each from its own slot, into the target in the order written',
  );
});

// The staging buffer is sized from the batches the current pool may draw (`shadowBatchCapacity`),
// within the grant the memory budget counts: a smaller pool stages less, a frame that reserves no
// more than before makes nothing, and one that reserves more makes the grant's, once.
test('the staging buffer is made at the reserved capacity, then at the grant once', () => {
  const { device, buffers, writes, destroyed } = fakeDevice();
  const target = device.createBuffer({ size: SHADOW_BATCH_WRITE_BYTES, usage: 0 }),
    batches = shadowBatchWrites(device),
    batch = new Uint32Array(SHADOW_BATCH_WRITE_BYTES / 4),
    small = shadowBatchCapacity(2601, MAX_SHADOW_PAGES, Infinity).stagingBytes;
  batches.reserve(small);
  batches.stage(device.createCommandEncoder());
  batches.write(target, 0, batch);
  batches.end();
  batches.reserve(small / 2);
  assert.equal(buffers.length, 2, 'a smaller frame keeps the staging');
  batches.reserve(small + SHADOW_BATCH_WRITE_BYTES);
  batches.stage(device.createCommandEncoder());
  batches.write(target, 0, batch);
  batches.end();
  for (let frame = 0; frame < 2; frame++) {
    batches.reserve(SHADOW_STAGING_BYTES);
    for (let k = 1; k < MAX_SHADOW_BATCHES; k++) {
      batches.stage(device.createCommandEncoder());
      batches.write(target, 0, batch);
    }
    batches.end();
  }
  const staging = buffers.filter((buffer) => buffer !== (target as unknown));
  assert.deepEqual(
    staging.map(({ size }) => size),
    [small, SHADOW_STAGING_BYTES],
    "the pool's, then, grown, the grant's: every batch of its frame but the first",
  );
  assert.deepEqual(destroyed, [buffers[1]], 'the smaller one released');
  batches.stage(device.createCommandEncoder());
  batches.write(target, 0, batch);
  assert.throws(() => batches.write(target, 0, Uint32Array.of(1)), /SHADOW_BATCH_WRITES_OVERFLOW/);
  const uploads = writes.length;
  batches.end();
  assert.equal(writes.length, uploads + 1, 'what fit is uploaded, once');
  batches.end();
  assert.equal(writes.length, uploads + 1, 'an end with nothing staged uploads nothing');
});

/** Draws `batches` batches of writes of `perBatch` words each, of every word type and from a
 *  window of their data; returns the device's record and the words each staged write was given. */
function frame(batches: number, perBatch: (batch: number) => readonly number[]) {
  const recorded = fakeDevice(),
    { device } = recorded,
    targets = [0, 1, 2].map(() =>
      device.createBuffer({ size: SHADOW_BATCH_WRITE_BYTES, usage: 0 }),
    ),
    writer = shadowBatchWrites(device),
    encoder = device.createCommandEncoder(),
    staged: Uint32Array[] = [];
  writer.reserve(SHADOW_STAGING_BYTES);
  let seed = 1;
  for (let batch = 0; batch < batches; batch++) {
    if (batch) writer.stage(encoder);
    perBatch(batch).forEach((count, k) => {
      const data = new [Uint32Array, Int32Array, Float32Array][k % 3](count + 2).map(() => seed++);
      writer.write(targets[k % 3], 4 * k, data, 1, count);
      if (batch) staged.push(new Uint32Array(data.buffer, 4, count));
    });
  }
  writer.end();
  return { ...recorded, targets, staged };
}

for (const [name, batches, perBatch] of [
  ['several batches', 5, (b: number) => [3 + b, 1, 7, b + 1]],
  [
    'the most batches, each at its largest',
    MAX_SHADOW_BATCHES,
    () => [SHADOW_BATCH_WRITE_BYTES / 4],
  ],
] as const) {
  test(`${name}: one upload for every staged write, each copy reading its own words`, () => {
    const { writes, copies, targets, staged } = frame(batches, perBatch),
      direct = perBatch(0).length;
    assert.equal(writes.length, direct + 1, 'the first batch, then one upload');
    assert.ok(
      writes.slice(0, direct).every((w, k) => w.buffer === targets[k % 3]),
      'straight',
    );
    assert.equal(copies.length, staged.length, 'one copy per staged write');
    const upload = writes[direct],
      words = written(upload);
    assert.equal(upload.offset, 0);
    copies.forEach(({ from, fromOffset, size }, k) => {
      assert.equal(from, upload.buffer);
      assert.deepEqual(words.subarray(fromOffset / 4, (fromOffset + size) / 4), staged[k], `${k}`);
    });
  });
}
