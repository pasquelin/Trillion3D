import test from 'node:test';
import assert from 'node:assert/strict';
import { markReach } from './halfFloat.ts';
import { fromHalf } from '../../../sdk-core/src/lighting/ltcTable.ts';

/** The reach the GPU cut reads of `reach`: the half float `markReach` packs in the high bits. */
const reachBits = (reach: number) => markReach(0, reach) >>> 16;
/** A positive half float's value, as `unpack2x16float` reads it: all exponent bits set is infinity. */
const halfValue = (bits: number) => (bits >= 0x7c00 ? Infinity : fromHalf(bits));

test('the reach the GPU cut reads is the smallest half float at or above the CPU one', () => {
  let seed = 357;
  for (let k = 0; k < 20000; k++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const x = 2 ** ((seed / 2 ** 32) * 44 - 26);
    const bits = reachBits(x);
    assert.ok(halfValue(bits) >= x, `${x}`);
    assert.ok(halfValue(bits - 1) < x, `${x} is not the smallest`);
  }
  assert.equal(reachBits(0), 0);
  assert.equal(halfValue(reachBits(1e9)), Infinity);
  // The mark keeps its low bits, the reach rides above them.
  assert.equal(markReach(0b101, 1) & 0xffff, 0b101);
  assert.equal(halfValue(markReach(0b101, 1) >>> 16), 1);
});
