import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RECTS_PER_SLICE,
  SHADOW_FACE_FLOATS,
  SHADOW_FACE_MASK_WORD,
  SHADOW_SLICE_FLOATS,
} from '../sdk-core/src/index.ts';
import { createShadowSlicePack } from './gpuShadowSlicePack.ts';

const STRIDE = 256;

/** Slices the pack flags to push, drained. */
function flushed(pack: ReturnType<typeof createShadowSlicePack>) {
  const slices: number[] = [];
  pack.flushSlices((slice) => slices.push(slice));
  return slices;
}

test('a slid region translates the draw matrix by whole pages and leaves the slice the extent matrix', () => {
  const pack = createShadowSlicePack(4096, STRIDE);
  const matrices = new Float32Array(16);
  for (let i = 0; i < 16; i++) matrices[i] = i + 1;
  const rects = new Int32Array(RECTS_PER_SLICE);
  rects[2] = 1024;
  // Extent page (0, 0) at physical page (3, 5): shift by 3/8 and 5/8 of the face, in clip units.
  pack.writeRegion(0, 0, 0, matrices, 0, rects, undefined, 0, (2 * 3) / 8, (-2 * 5) / 8);
  const uniform = pack.facePacked.subarray(0, 16),
    slice = pack.slicePacked.subarray(0, 16);
  assert.deepEqual(Array.from(slice), Array.from(matrices), 'the read keeps the extent matrix');
  assert.equal(uniform[12], matrices[12] + 0.75);
  assert.equal(uniform[13], matrices[13] - 1.25);
  for (let i = 0; i < 16; i++) if (i !== 12 && i !== 13) assert.equal(uniform[i], matrices[i]);
  // The slice rectangle ends with the drawn flag, and the slice is flagged to push once.
  assert.equal(pack.slicePacked[19], 1);
  assert.deepEqual(flushed(pack), [0]);
  assert.deepEqual(flushed(pack), [], 'the flag dropped with the flush');
});

test('a face with no atlas rectangle stays "never drawn"', () => {
  const pack = createShadowSlicePack(4096, STRIDE);
  pack.writeRegion(0, 1, 2, new Float32Array(16), 0, new Int32Array(RECTS_PER_SLICE), undefined, 0);
  assert.equal(pack.slicePacked[SHADOW_SLICE_FLOATS + 2 * SHADOW_FACE_FLOATS + 19], 0);
});

test('the held mask carries the wrap origin in its spare words, and only a change flags the slice', () => {
  const pack = createShadowSlicePack(4096, STRIDE);
  const words = new Uint32Array(pack.slicePacked.buffer);
  const at = 2 * SHADOW_SLICE_FLOATS + SHADOW_FACE_FLOATS + SHADOW_FACE_MASK_WORD;
  pack.writeDrawnMask(2, 1, 0xffffff00, 0xffffffff, 3, 5);
  assert.deepEqual(Array.from(words.subarray(at, at + 4)), [0xffffff00, 0xffffffff, 3, 5]);
  assert.deepEqual(flushed(pack), [2]);
  pack.writeDrawnMask(2, 1, 0xffffff00, 0xffffffff, 3, 5);
  assert.deepEqual(flushed(pack), [], 'the same words: nothing to push');
  pack.writeDrawnMask(2, 1, 0xffffff00, 0xffffffff, 4, 5);
  assert.deepEqual(flushed(pack), [2], 'the origin moved: pushed');
});
