// Shared formulae lot: packedRowBase, factored out of 2 copies (first write of a row and the
// compact that moves it).
import test from 'node:test';
import assert from 'node:assert/strict';
import { packedRowBase } from './webgpuPageRow.ts';
import { VIS_TRIANGLE_BITS } from './visibilityBuffer.ts';

test('packedRowBase shifts the rank by VIS_TRIANGLE_BITS bits, one rank further than the rank', () => {
  assert.equal(packedRowBase(0), 1 << VIS_TRIANGLE_BITS);
  assert.equal(packedRowBase(5), 6 << VIS_TRIANGLE_BITS);
});

test('packedRowBase at the first row (rank 0) reserves zero for the background', () => {
  assert.equal(packedRowBase(0), 256);
  assert.notEqual(packedRowBase(0), 0);
});

test('packedRowBase returns a 32-bit unsigned integer for a large rank', () => {
  const value = packedRowBase(0xffffff);
  assert.ok(Number.isInteger(value) && value >= 0);
  assert.equal(value, ((0xffffff + 1) << VIS_TRIANGLE_BITS) >>> 0);
});
