import test from 'node:test';
import assert from 'node:assert/strict';
import { halfAtLeast, halfValue, markReach } from './webgpuFrame.ts';

test('the reach the GPU cut reads is the smallest half float at or above the CPU one', () => {
  let seed = 357;
  for (let k = 0; k < 20000; k++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const x = 2 ** ((seed / 2 ** 32) * 44 - 26);
    const bits = halfAtLeast(x);
    assert.ok(halfValue(bits) >= x, `${x}`);
    assert.ok(halfValue(bits - 1) < x, `${x} is not the smallest`);
  }
  assert.equal(halfAtLeast(0), 0);
  assert.equal(halfValue(halfAtLeast(1e9)), Infinity);
  // The mark keeps its low bits, the reach rides above them.
  assert.equal(markReach(0b101, 1) & 0xffff, 0b101);
  assert.equal(halfValue(markReach(0b101, 1) >>> 16), 1);
});
