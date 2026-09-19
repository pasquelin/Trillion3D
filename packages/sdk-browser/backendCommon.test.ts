// Shared-formulas batch: devicePixels, factored out of 2 copies (canvas creation and
// resize). Nominal behaviours and limits, distinct from the bit-for-bit equivalence bench.
import test from 'node:test';
import assert from 'node:assert/strict';
import { devicePixels, DEFAULT_PIXEL_RATIO } from './backendCommon.ts';

test('devicePixels truncates the product of the logical dimension and the device ratio', () => {
  assert.equal(devicePixels(100, 2), 200);
  assert.equal(devicePixels(100, 1.5), 150);
  assert.equal(devicePixels(101, 1.999), 201);
});

test('devicePixels falls back to the default ratio when it is absent', () => {
  assert.equal(devicePixels(100, undefined), Math.floor(100 * DEFAULT_PIXEL_RATIO));
});

test('devicePixels returns zero for a null dimension and truncates down on an odd ratio', () => {
  assert.equal(devicePixels(0, 3), 0);
  assert.equal(devicePixels(3, 0.5), 1);
});
