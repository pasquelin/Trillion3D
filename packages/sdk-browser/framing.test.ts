import test from 'node:test';
import assert from 'node:assert/strict';
import { framingFromBounds } from './index.ts';

test('framingFromBounds scales near with the bounding radius and has no centimetre floor', () => {
  const millimetre = framingFromBounds(0.02, 16 / 9);
  assert.ok(millimetre.near > 0);
  assert.ok(millimetre.near < 0.01);
  assert.equal(millimetre.far, 0.4);
  const metre = framingFromBounds(20, 1);
  assert.equal(metre.near, 0.002);
  assert.equal(metre.far, 400);
  const a = framingFromBounds(1, 1),
    b = framingFromBounds(10, 1);
  assert.ok(Math.abs(a.offset[0] * 10 - b.offset[0]) < 1e-12);
  assert.throws(() => framingFromBounds(0, 1));
  assert.throws(() => framingFromBounds(1, 0));
});
