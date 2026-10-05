import test from 'node:test';
import assert from 'node:assert/strict';
import { LTC_SIZE, encodeLtcTable, fromHalf, ltcTable, toHalf } from './ltcTable.ts';

/** IEEE 754 binary16: an exponent field of all ones is infinity or NaN, never a finite value. */
const HALF_INFINITY = 0x7c00;
const finiteHalves = Array.from({ length: 1 << 16 }, (_, bits) => bits).filter(
  (bits) => (bits & HALF_INFINITY) !== HALF_INFINITY,
);
/** The halves `encodeLtcTable` wrote: base64 of little-endian sixteen-bit words. */
const encodedHalves = (text: string) => {
  const bytes = Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
  assert.equal(bytes.length % 2, 0, 'two bytes a half');
  const view = new DataView(bytes.buffer);
  return Array.from({ length: bytes.length / 2 }, (_, i) => fromHalf(view.getUint16(i * 2, true)));
};

test('every finite half reads back to its own bits', () => {
  const wrong = finiteHalves.filter((bits) => toHalf(fromHalf(bits)) !== bits);
  assert.deepEqual(wrong, []);
});

test('a value between two neighbouring halves is stored as the nearer one, on either sign', () => {
  const wrong: number[] = [];
  for (let bits = 0; bits < HALF_INFINITY; bits++) {
    const low = fromHalf(bits),
      step = fromHalf(bits + 1) - low;
    for (const sign of [1, -1]) {
      const negative = sign < 0 ? toHalf(-0) : 0;
      if (toHalf(sign * (low + step / 4)) !== (bits | negative)) wrong.push(sign * bits);
      if (toHalf(sign * (low + (3 * step) / 4)) !== ((bits + 1) | negative))
        wrong.push(sign * bits);
    }
  }
  assert.deepEqual(wrong, []);
});

test('a value halfway between two halves takes the even one, a NaN stays a NaN', () => {
  // Every float32 against IEEE 754 binary16 (`Float16Array`): 0 differences but NaN payloads.
  const one = 0x3c00,
    step = 2 ** -10;
  assert.equal(toHalf(1 + step / 2), one, 'tie below an odd half: down to even');
  assert.equal(toHalf(1 + (3 * step) / 2), one + 2, 'tie below an even half: up to even');
  assert.equal(toHalf(-(1 + (3 * step) / 2)), (one + 2) | toHalf(-0));
  assert.equal(toHalf(2 ** -25), 0, 'half the smallest half: down to zero');
  assert.equal(toHalf(3 * 2 ** -25), 2, 'one and a half smallest halves: up to two');
  assert.equal(toHalf(65520), HALF_INFINITY, 'halfway past the largest half: infinity');
  // A float64 just off a tie that float32 rounds onto it: the side it lies on decides.
  assert.equal(toHalf(1 + (3 * step) / 2 - 2 ** -40), one + 1);
  assert.equal(toHalf(1 + step / 2 + 2 ** -40), one + 1);
  assert.equal(toHalf(NaN), 0x7e00);
});

test('values past the largest half store as infinity and values far below the smallest as zero', () => {
  const largest = fromHalf(HALF_INFINITY - 1);
  for (const value of [largest * 2, largest * 1e3, Number.MAX_VALUE, Infinity]) {
    assert.equal(toHalf(value), HALF_INFINITY, `${value}`);
    assert.equal(toHalf(-value), HALF_INFINITY | toHalf(-0), `${-value}`);
  }
  // Below a quarter of the smallest half, at every binary64 exponent down to the smallest float.
  const smallest = fromHalf(1);
  for (let shift = 2; smallest / 2 ** shift > 0; shift++) {
    const value = smallest / 2 ** shift;
    assert.equal(toHalf(value), 0, `${value}`);
    assert.equal(toHalf(-value), toHalf(-0), `${-value}`);
  }
});

test('the table is decoded once into the cells the GPU reads', () => {
  const table = ltcTable();
  assert.equal(ltcTable(), table);
  assert.ok(Number.isInteger(table.length / LTC_SIZE ** 2));
  assert.ok(table.length / LTC_SIZE ** 2 >= 6);
});

test('every cell holds an orientation-preserving transform, a magnitude and a share, then zeros', () => {
  const table = ltcTable(),
    floats = table.length / LTC_SIZE ** 2;
  const wrong: number[] = [];
  for (let cell = 0; cell < LTC_SIZE ** 2; cell++) {
    const [xx, xz, zx, zz, magnitude, share, ...padding] = table.slice(
      cell * floats,
      (cell + 1) * floats,
    );
    if (
      !(xx > 0) ||
      !(xx * zz - xz * zx > 0) ||
      !(magnitude > 0 && magnitude <= 1) ||
      !(share >= 0 && share <= 1) ||
      padding.some((value) => value !== 0)
    )
      wrong.push(cell);
  }
  assert.deepEqual(wrong, []);
});

test('encoding keeps the six values of each cell, which decode back to the same table', () => {
  const table = ltcTable(),
    floats = table.length / LTC_SIZE ** 2;
  const kept = [...table].filter((_, i) => i % floats < 6);
  assert.deepEqual(encodedHalves(encodeLtcTable(table)), kept);
  const padded = table.slice();
  for (let cell = 0; cell < LTC_SIZE ** 2; cell++)
    padded.fill(cell + 1, cell * floats + 6, (cell + 1) * floats);
  assert.equal(encodeLtcTable(padded), encodeLtcTable(table));
});

test('encoding rounds each kept value to its nearest half', () => {
  const cell = [1.0006, -2.5, 3e-6, 70000, 0.333, -0.1, 7, 8];
  assert.deepEqual(
    encodedHalves(encodeLtcTable(Float32Array.from([...cell, ...cell.map((v) => -v)]))),
    [...cell.slice(0, 6), ...cell.slice(0, 6).map((v) => -v)].map((v) => fromHalf(toHalf(v))),
  );
});
