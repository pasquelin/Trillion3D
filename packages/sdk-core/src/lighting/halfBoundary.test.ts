import test from 'node:test';
import assert from 'node:assert/strict';
import { toHalf, fromHalf } from './ltcTable.ts';

test('half storage saturates finite overflow and preserves the middle subnormal range', () => {
  assert.equal(toHalf(70000), 0x7c00);
  assert.equal(toHalf(-70000), 0xfc00);
  assert.equal(toHalf(2 ** -15), 0x0200);
  assert.equal(fromHalf(0x0200), 2 ** -15);
  assert.equal(toHalf(2 ** -48), 0);
  assert.equal(toHalf(-(2 ** -48)), 0x8000);
});
