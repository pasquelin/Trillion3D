import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fromArrays } from '../world/geometry/builder.ts';
import { softBodyOf, softSettings, type SoftBodyOptions } from './soft.ts';
import { goldenCloth } from './softCloth.fixture.ts';

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

const cloth = goldenCloth();
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

test('the compiler cooks the same soft record the page builds: vertices, masses and corners bit for bit', async () => {
  const cooked = await cookedRecords();
  assert.equal(cooked.length, cases.length);
  cases.forEach(([geometry, scale, options], i) => {
    const built = softBodyOf(geometry, scale, softSettings(options));
    assert.deepEqual(cooked[i].vertices, Array.from(built.vertices), `${options.type} vertices`);
    assert.deepEqual(cooked[i].indices, Array.from(built.indices), `${options.type} corners`);
    const gap = Math.abs(cooked[i].pressure - built.pressure);
    assert.ok(gap <= 1e-12 * Math.max(1, built.pressure), `${options.type} pressure ${gap}`);
  });
});
