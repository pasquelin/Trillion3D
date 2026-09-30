import test from 'node:test';
import assert from 'node:assert/strict';
import { toHalf, fromHalf, encodeLtcTable, ltcTable } from './ltcTable.ts';

test('half precision storage retains signed normal, subnormal and rounded finite values', () => {
  const values = [
    [0, 0],
    [-0, 0x8000],
    [1, 0x3c00],
    [-1, 0xbc00],
    [2, 0x4000],
    [0.5, 0x3800],
    [65504, 0x7bff],
    [2 ** -14, 0x0400],
    [2 ** -24, 1],
    [2 ** -25, 1],
    [2 ** -26, 0],
    [-(2 ** -24), 0x8001],
  ];
  for (const [value, bits] of values) {
    assert.equal(toHalf(value), bits);
    if (value !== 2 ** -25 && value !== 2 ** -26) assert.equal(fromHalf(bits), value);
  }
  assert.equal(toHalf(Infinity), 0x7c00);
  assert.equal(toHalf(-Infinity), 0xfc00);
  assert.equal(toHalf(1.0006), 0x3c01);
  assert.equal(fromHalf(0x3c01), 1.0009765625);
});

test('encoded LTC cells retain six physical coefficients and leave two padding channels unused', () => {
  const encoded = encodeLtcTable(
    new Float32Array([1, 2, 3, 4, 0.5, -0.5, 91, 92, 5, 6, 7, 8, 0.25, -0.25, 93, 94]),
  );
  const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
  const halves = new Uint16Array(bytes.buffer);
  assert.deepEqual([...halves].map(fromHalf), [1, 2, 3, 4, 0.5, -0.5, 5, 6, 7, 8, 0.25, -0.25]);
  const table = ltcTable();
  assert.equal(ltcTable(), table);
  assert.equal(table.length, 32768);
  assert.ok(table.some((value) => value !== 0));
  assert.ok(table.every(Number.isFinite));
  for (let cell = 0; cell < 4096; cell++) {
    assert.equal(table[cell * 8 + 6], 0);
    assert.equal(table[cell * 8 + 7], 0);
    assert.ok(table[cell * 8 + 4] >= 0);
  }
});
