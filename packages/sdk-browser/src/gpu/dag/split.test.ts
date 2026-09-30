// A cut's tables past one binding split in parts bound at once (#974): a host write lands in the
// part that holds each of its bytes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeParts } from './split.ts';

test('a host write spanning two parts lands in each at its own offset', () => {
  const writes: [string, number, number, number][] = [];
  const device = {
    queue: {
      writeBuffer: (b: { name: string }, at: number, _d: unknown, from: number, size: number) =>
        writes.push([b.name, at, from, size]),
    },
  } as unknown as GPUDevice;
  const buffers = [{ name: 'a' }, { name: 'b' }] as unknown as GPUBuffer[];
  writeParts(device, { buffers, bytes: 64 }, 56, new ArrayBuffer(128), 56, 16);
  assert.deepEqual(writes, [
    ['a', 56, 56, 8],
    ['b', 0, 64, 8],
  ]);
});
