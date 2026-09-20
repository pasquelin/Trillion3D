import assert from 'node:assert/strict';
import test from 'node:test';
import { RECTS_PER_SLICE, SHADOW_FACE_FLOATS, SHADOW_SLICE_FLOATS } from '../sdk-core/index.ts';
import { createShadowSlicePack, wrapKey } from './gpuShadowSlicePack.ts';

const STRIDE = 256;

test('a slid region translates the draw matrix by whole pages and leaves the slice the window matrix', () => {
  const pack = createShadowSlicePack(4096, STRIDE);
  const matrices = new Float32Array(16);
  for (let i = 0; i < 16; i++) matrices[i] = i + 1;
  const rects = new Int32Array(RECTS_PER_SLICE);
  rects[2] = 1024;
  // Window page (0, 0) at physical page (3, 5): shift by 3/8 and 5/8 of the face, in clip units.
  pack.writeRegion(
    0,
    0,
    0,
    matrices,
    0,
    rects,
    undefined,
    0,
    (2 * 3) / 8,
    (-2 * 5) / 8,
    wrapKey(3, 5),
  );
  const uniform = pack.facePacked.subarray(0, 16),
    slice = pack.slicePacked.subarray(0, 16);
  assert.deepEqual(Array.from(slice), Array.from(matrices), 'the read keeps the window matrix');
  assert.equal(uniform[12], matrices[12] + 0.75);
  assert.equal(uniform[13], matrices[13] - 1.25);
  for (let i = 0; i < 16; i++) if (i !== 12 && i !== 13) assert.equal(uniform[i], matrices[i]);
  // The slice rectangle ends with the wrap key: 1 + 3 + 16·5.
  assert.equal(pack.slicePacked[19], 84);
});

test('a face with no atlas rectangle stays "never drawn" whatever its wrap', () => {
  const pack = createShadowSlicePack(4096, STRIDE);
  pack.writeRegion(
    0,
    1,
    2,
    new Float32Array(16),
    0,
    new Int32Array(RECTS_PER_SLICE),
    undefined,
    0,
    0,
    0,
    wrapKey(7, 7),
  );
  assert.equal(pack.slicePacked[SHADOW_SLICE_FLOATS + 2 * SHADOW_FACE_FLOATS + 19], 0);
});
