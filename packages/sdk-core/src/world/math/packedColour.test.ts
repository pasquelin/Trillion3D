import test from 'node:test';
import assert from 'node:assert/strict';
import { clearValueOf, rgbHex } from './packedColour.ts';

test('a packed colour unpacks to its three bytes over 255, opaque, and bytes pack to two hex digits each', () => {
  assert.deepEqual(clearValueOf(0x123456), { r: 0x12 / 255, g: 0x34 / 255, b: 0x56 / 255, a: 1 });
  assert.equal(rgbHex(1, 2, 15), '#01020f');
});
