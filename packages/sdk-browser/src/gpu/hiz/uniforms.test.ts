import test from 'node:test';
import assert from 'node:assert/strict';
import { writeHizTestUniforms } from './uniforms.ts';

/** The slot the test encoding uploaded before #917: a zeroed float array, integer words written
 *  through a fresh view, the depth bias as the bits of a fresh `Float32Array([0])`. */
function slotBefore(words: number, width: number, height: number, rows: number) {
  const packed = new Float32Array(words);
  const bias = new Uint32Array(new Float32Array([0]).buffer)[0];
  new Uint32Array(packed.buffer).set([width, height, rows, bias]);
  return new Uint8Array(packed.buffer);
}

test('the Hi-Z test slot uploads the bytes it did, from one array reused every frame', () => {
  const uploads: { offset: number; bytes: Uint8Array; source: unknown }[] = [];
  const device = {
    queue: {
      writeBuffer: (_: unknown, offset: number, data: Uint32Array) =>
        uploads.push({ offset, bytes: new Uint8Array(data.slice().buffer), source: data }),
    },
  } as unknown as GPUDevice;
  const words = new Uint32Array(64);
  const frames = [
    [1920, 1080, 4096],
    [1920, 1080, 17],
    [7, 3, 0],
    [16384, 16384, 2 ** 32 - 1],
  ];
  for (const [width, height, rows] of frames)
    writeHizTestUniforms(device, {} as GPUBuffer, words, 2304, width, height, rows);
  frames.forEach(([width, height, rows], frame) => {
    assert.equal(uploads[frame].offset, 2304);
    assert.equal(uploads[frame].source, words);
    assert.deepEqual(uploads[frame].bytes, slotBefore(64, width, height, rows));
  });
});
