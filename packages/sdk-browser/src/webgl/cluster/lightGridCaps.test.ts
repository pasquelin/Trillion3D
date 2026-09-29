import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sphereTouchesBox,
  type Box,
} from '../../../../../bench/oracles/browser/gpuLightTileColumnOracle.ts';
import { CELLS_PER_LAMP, MOST_CELLS_ON_AXIS, MOST_ENTRIES } from './lightGrid.ts';
import { lastUniform, lightFrames, pointLamp, sent, triangle } from './lightGrid.fixture.ts';

// #835: a limit of the WebGL2 light grid — cells per lamp, cells along an axis, (cell, lamp)
// entries — never drops a lamp from a pixel it reaches: past a limit the grid's cells widen, and
// every lamp stays listed in every cell its range touches (the tiles' oracle, `sphereTouchesBox`),
// its whole reach inside the grid.

type Lamp = { at: [number, number, number]; range: number };

/** Draws `lamps` from the world's origin; checks each against the oracle in every cell of the
 *  grid its range touches, and returns the grid: its cells, its cell's side, its entries. */
function listedEverywhere(lamps: readonly Lamp[]) {
  const lights = lamps.map(({ at, range }) => pointLamp(at, range));
  const { context, renderer, frame } = lightFrames(lights, [triangle(0)]);
  frame();
  const [, m] = lastUniform(context, 'uniformMatrix4fv', 'viewToGrid') as [boolean, Float32Array];
  const cells = lastUniform(context, 'uniform3i', 'gridCells') as number[];
  const [every] = lastUniform(context, 'uniform1i', 'lightGrid') as number[];
  const data = sent(context, 'RED_INTEGER').at(-1)![8] as Int32Array;
  const total = cells[0] * cells[1] * cells[2],
    side = 1 / m[0];
  assert.equal(every, 0, 'every lamp has a range: none is listed for every fragment');
  // Every (cell, slot) entry, once.
  const listed = new Set<number>();
  for (let k = 0; k < total; k++)
    for (let e = data[every + k]; e < data[every + k + 1]; e++)
      listed.add(k * lamps.length + data[e]);
  // The lamp's reach, short of single precision's error on the grid's matrix.
  const give = side * 1e-3;
  lamps.forEach(({ at, range }, slot) => {
    const reach = range - give;
    const lo = [0, 1, 2].map((a) => Math.floor(m[5 * a] * (at[a] - reach) + m[12 + a]));
    const hi = [0, 1, 2].map((a) => Math.floor(m[5 * a] * (at[a] + reach) + m[12 + a]));
    for (let a = 0; a < 3; a++)
      assert.ok(lo[a] >= 0 && hi[a] < cells[a], `lamp ${slot}'s reach lies inside the grid`);
    for (let k = lo[2]; k <= hi[2]; k++)
      for (let j = lo[1]; j <= hi[1]; j++)
        for (let i = lo[0]; i <= hi[0]; i++) {
          const low = [i, j, k].map((c, a) => (c - m[12 + a]) / m[5 * a]) as Box['lo'];
          const box = { lo: low, hi: low.map((v) => v + side) as Box['hi'] };
          if (!sphereTouchesBox(box, at, reach)) continue;
          const cell = (k * cells[1] + j) * cells[0] + i;
          assert.ok(listed.has(cell * lamps.length + slot), `lamp ${slot} in cell ${i},${j},${k}`);
        }
  });
  renderer.dispose();
  return { cells, total, side, entries: listed.size };
}

test('past the cells per lamp, the cells widen and every lamp stays in every cell it reaches', () => {
  // Two small lamps 50 apart and one of range 30 between them: cells of the median range, 0.1,
  // would be 800×600×600 for three lamps.
  const lamps: Lamp[] = [
    { at: [0, 0, 0], range: 0.1 },
    { at: [25, 0, 0], range: 30 },
    { at: [50, 0, 0], range: 0.1 },
  ];
  const { total, side } = listedEverywhere(lamps);
  assert.ok(side > 0.1, `the cells widened past the median range, to ${side}`);
  assert.ok(total <= CELLS_PER_LAMP * lamps.length, `${total} cells for 3 lamps`);
});

test('past the cells along an axis, the cells widen and every lamp stays in every cell it reaches', () => {
  // 2000 lamps of range 1 in a row 5000 long: cells of the median range would be 5000 along x,
  // while the grid's cells in all, 3×3 across, stay within their limits.
  const lamps = Array.from({ length: 2000 }, (_, i): Lamp => ({
    at: [i * 2.5, (i % 3) * 0.1, 0],
    range: 1,
  }));
  const { cells, side } = listedEverywhere(lamps);
  assert.ok(side > 1, `the cells widened past the median range, to ${side}`);
  assert.ok(cells[0] <= MOST_CELLS_ON_AXIS, `${cells[0]} cells along x`);
  assert.ok(cells[0] > MOST_CELLS_ON_AXIS / 2, 'the axis limit is the one that widened the cells');
});

test('past the (cell, lamp) entries, the cells widen and every lamp stays in every cell it reaches', () => {
  // 501 small lamps under 500 that reach the whole grid: at the median range, 0.1, each of the
  // 500 would be listed in every one of the grid's cells, hundreds of millions of entries.
  const lamps = Array.from({ length: 1001 }, (_, i): Lamp => ({
    at: [(i % 10) * 4, Math.floor(i / 10) % 10, Math.floor(i / 100) * 4],
    range: i % 2 ? 20 : 0.1,
  }));
  const { total, side, entries } = listedEverywhere(lamps);
  assert.ok(side > 0.1, `the cells widened past the median range, to ${side}`);
  assert.ok(entries <= MOST_ENTRIES, `${entries} entries`);
  assert.ok(500 * total > MOST_ENTRIES / 4, 'the entries limit is the one that widened the cells');
});
