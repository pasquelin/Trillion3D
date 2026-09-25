import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { plane } from '../world/geometry/basic.ts';
import { fromArrays } from '../world/geometry/builder.ts';
import { softBodyOf, softSettings, type SoftBodyOptions } from './soft.ts';

/**
 * The records the compiler's cook writes (`physics_cook/soft_page_tests.rs`, which mirrors
 * `softBodyOf` in `soft_record.rs`), each `u32` word count, `f32` words, `u32` corner count,
 * `u32` corners, `f64` pressure.
 */
async function cookedRecords() {
  const file = await readFile(
    new URL('../../../../tests/fixtures/physics/soft-records.bin', import.meta.url),
  );
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  let at = 0;
  /** A count, then that many 4-byte values read by `get`. */
  const read = (get: (offset: number) => number) => {
    const count = view.getUint32(at, true);
    const values = Array.from({ length: count }, (_, i) => get(at + 4 + i * 4));
    at += 4 + count * 4;
    return values;
  };
  const records = [];
  while (at < file.byteLength) {
    const vertices = read((offset) => view.getFloat32(offset, true));
    const indices = read((offset) => view.getUint32(offset, true));
    records.push({ vertices, indices, pressure: view.getFloat64(at, true) });
    at += 8;
  }
  return records;
}

// The compiler's golden cloth (`physics_cook/soft_tests.rs`): 1 m of 2 × 2 squares, row by row.
const cloth = plane(1, 1, 2, 2);
const seam = fromArrays([0, 0, 0, 1, 0, 0, 1, 0, 0, 2, 0.5, 0], [], [], []);
const tetra = fromArrays(
  [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1],
  [],
  [],
  [0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3],
);
const cases: [typeof cloth, { x: number; y: number; z: number }, SoftBodyOptions][] = [
  [cloth, { x: 1, y: 1, z: 1 }, { type: 'cloth', pins: [6, 8], bend: 0.01 }],
  [seam, { x: 2, y: 1, z: 3 }, { type: 'rope', pins: [0], bend: 0.01, mass: 0.3 }],
  [tetra, { x: 1, y: 1, z: 1 }, { type: 'volume' }],
];

test('the compiler cooks the same soft record the page builds: vertices, masses, corners and pressure bit for bit', async () => {
  const cooked = await cookedRecords();
  assert.equal(cooked.length, cases.length);
  cases.forEach(([geometry, scale, options], i) => {
    const built = softBodyOf(geometry, scale, softSettings(options));
    assert.deepEqual(cooked[i].vertices, Array.from(built.vertices), `${options.type} vertices`);
    assert.deepEqual(cooked[i].indices, Array.from(built.indices), `${options.type} corners`);
    assert.equal(cooked[i].pressure, built.pressure, `${options.type} pressure`);
  });
});
