// A5: hizTestRect starts at the first mip level `Math.clz32` allows instead of trying every
// level from 0. Oracle: the linear search from before batch A, in
// `../../bench/oracles/browser/hiz.ts`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { HIZ_TEST_VALUES, hizTestRect } from './hizOcclusion.ts';
import { referenceHizTestRect } from '../../bench/oracles/browser/hiz.ts';

function bothAgree(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  clipsNear: boolean,
  width: number,
  height: number,
  levels: number,
) {
  const into = new Int32Array(HIZ_TEST_VALUES),
    intoRef = new Int32Array(HIZ_TEST_VALUES);
  const found = hizTestRect(minX, minY, maxX, maxY, clipsNear, width, height, levels, into);
  const foundRef = referenceHizTestRect(
    minX,
    minY,
    maxX,
    maxY,
    clipsNear,
    width,
    height,
    levels,
    intoRef,
  );
  assert.equal(found, foundRef, `hizTestRect(${minX},${minY},${maxX},${maxY})`);
  if (found) assert.deepEqual([...into], [...intoRef]);
  return found;
}

test('a near-plane crossing, a reversed rectangle and a zero-sized viewport are all rejected', () => {
  assert.equal(bothAgree(0, 0, 4, 4, true, 64, 64, 4), false);
  assert.equal(bothAgree(4, 4, 0, 0, false, 64, 64, 4), false);
  assert.equal(bothAgree(0, 0, 4, 4, false, 0, 64, 4), false);
  assert.equal(bothAgree(0, 0, 4, 4, false, 64, 64, 0), false);
  assert.equal(bothAgree(1.5, 0, 4, 4, false, 64, 64, 4), false, 'non-integer bound');
});

test('a rectangle entirely outside the viewport is rejected, one that only clips at the edge is kept', () => {
  assert.equal(bothAgree(100, 100, 200, 200, false, 64, 64, 4), false);
  assert.equal(bothAgree(-8, -8, -1, -1, false, 64, 64, 4), false);
  assert.equal(bothAgree(-8, -8, 8, 8, false, 64, 64, 4), true);
});

test('the finest level whose footprint fits the kernel matches the linear search at every boundary', () => {
  // Spans straddling every power-of-two boundary from 1 to 4096, shifted so a non-zero minX
  // exercises the same arithmetic on both sides.
  const spans = [
    0, 1, 2, 3, 4, 7, 8, 15, 16, 31, 32, 63, 64, 127, 128, 255, 256, 511, 512, 1023, 1024, 2047,
    2048, 4095, 4096,
  ];
  for (const span of spans)
    for (const min of [0, 1, 37]) {
      bothAgree(min, min, min + span, min + span, false, 8192, 8192, 14);
      bothAgree(min, min, min + span + 1, min + span, false, 8192, 8192, 14);
    }
});

test('a huge box against a small pyramid clamps to the viewport and still matches the reference', () => {
  bothAgree(-1000000, -1000000, 1000000, 1000000, false, 16, 16, 5);
  bothAgree(0, 0, 0, 0, false, 1, 1, 1);
});
