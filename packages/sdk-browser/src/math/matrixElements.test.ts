// matrixElements.ts: sixteen numbers compared bit for bit — the sign of a zero tells two
// translations apart, a NaN left in place is no change — or by value.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sameElements, sameMatrixBits } from './matrixElements.ts';

test('sameMatrixBits tells the sign of a zero and keeps a NaN equal to itself; sameElements merges both', () => {
  const held = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, NaN, 0, 0, 1];
  const now = held.slice();
  assert.equal(sameMatrixBits(held, now), true, 'a NaN left in place is no change');
  now[13] = -0;
  assert.equal(sameMatrixBits(held, now), false, '-0 is not 0');
  now[12] = held[12] = 0;
  assert.equal(sameElements(held, now), true, 'by value, -0 is 0');
});
