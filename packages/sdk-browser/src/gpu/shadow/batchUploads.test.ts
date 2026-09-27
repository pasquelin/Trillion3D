// A frame's staged shadow writes reach the GPU in one upload (#344): the measured 8-lamp frame
// spent 113 of its 130 ms in one `writeBuffer` per staged write. Whatever the batches, each copy
// still reads the very words its write was given, as the one call per write did.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDevice, written } from '../../../../../tests/kit/gpu/fakeDevice.ts';
import { shadowBatchWrites } from './batchWrites.ts';
import { MAX_SHADOW_BATCHES, SHADOW_BATCH_WRITE_BYTES } from './batchBudget.ts';

type Words = Uint32Array<ArrayBuffer> | Int32Array<ArrayBuffer> | Float32Array<ArrayBuffer>;

/** Draws `batches` batches of `perBatch` writes, of every word type and from a window of their
 *  data, and returns the device's record and the words each staged write was given. */
function frame(batches: number, perBatch: (batch: number) => number[]) {
  const recorded = fakeDevice(),
    { device } = recorded,
    targets = [0, 1, 2].map(() =>
      device.createBuffer({ size: SHADOW_BATCH_WRITE_BYTES, usage: 0 }),
    ),
    writer = shadowBatchWrites(device),
    encoder = device.createCommandEncoder(),
    staged: Uint32Array[] = [];
  let seed = 1;
  for (let batch = 0; batch < batches; batch++) {
    if (batch) writer.stage(encoder);
    perBatch(batch).forEach((count, k) => {
      const type = [Uint32Array, Int32Array, Float32Array][k % 3],
        data: Words = new type(count + 2).map(() => seed++);
      writer.write(targets[k % 3], 4 * k, data, 1, count);
      if (batch) staged.push(new Uint32Array(data.buffer, 4, count));
    });
  }
  writer.end();
  return { ...recorded, targets, staged };
}

/** The staging buffer's bytes once the frame's uploads landed, as the queue applies them. */
function stagingAfter({ writes, buffers }: ReturnType<typeof frame>, staging: GPUBuffer) {
  const size = buffers.find((b) => b === (staging as unknown))!.size,
    bytes = new Uint8Array(size);
  for (const write of writes.filter((w) => w.buffer === staging)) {
    const words = written(write);
    bytes.set(new Uint8Array(words.buffer, words.byteOffset, words.byteLength), write.offset);
  }
  return new Uint32Array(bytes.buffer);
}

for (const [name, batches, perBatch] of [
  ['one batch', 1, () => [3, 5, 2]],
  ['several batches', 5, (b: number) => [3 + b, 1, 7, b + 1]],
  [
    'the most batches, each at its largest',
    MAX_SHADOW_BATCHES,
    () => [SHADOW_BATCH_WRITE_BYTES / 4],
  ],
] as const) {
  test(`${name}: one upload for every staged write, each copy reading its own words`, () => {
    const record = frame(batches, perBatch),
      { writes, copies, targets, staged } = record,
      direct = perBatch(0).length;
    assert.equal(writes.length, direct + (batches > 1 ? 1 : 0), 'the first batch, then one upload');
    assert.ok(
      writes.slice(0, direct).every((w, k) => w.buffer === targets[k % 3]),
      'straight',
    );
    assert.equal(copies.length, staged.length, 'one copy per staged write');
    if (batches === 1) return;
    const staging = writes[direct].buffer,
      words = stagingAfter(record, staging);
    copies.forEach(({ from, fromOffset, size }, k) => {
      assert.equal(from, staging);
      assert.deepEqual(words.subarray(fromOffset / 4, (fromOffset + size) / 4), staged[k], `${k}`);
    });
  });
}

test('a batch past its bound is refused, and what fit is uploaded once', () => {
  const { device, writes } = fakeDevice(),
    target = device.createBuffer({ size: SHADOW_BATCH_WRITE_BYTES, usage: 0 }),
    writer = shadowBatchWrites(device),
    batch = new Uint32Array(SHADOW_BATCH_WRITE_BYTES / 4);
  writer.stage(device.createCommandEncoder());
  writer.write(target, 0, batch);
  assert.throws(() => writer.write(target, 0, Uint32Array.of(1)), /SHADOW_BATCH_WRITES_OVERFLOW/);
  writer.end();
  assert.deepEqual(
    writes.map((w) => [w.offset, written(w).length]),
    [[0, SHADOW_BATCH_WRITE_BYTES / 4]],
    'what fit is uploaded, once',
  );
  writer.end();
  assert.equal(writes.length, 1, 'an end with nothing staged uploads nothing');
});
