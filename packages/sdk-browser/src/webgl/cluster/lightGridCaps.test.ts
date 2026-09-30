import test from 'node:test';
import assert from 'node:assert/strict';
import { sphereTouchesBox } from '../../../../../bench/oracles/browser/gpuLightGridOracle.ts';
import { CELLS_PER_LAMP, MOST_CELLS_ON_AXIS, MOST_ENTRIES } from './lightGrid.ts';
import { cellBox, lightFrames, listedGrid, pointLamp, triangle } from './lightGrid.fixture.ts';

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
  const { m, cells, every, data, side } = listedGrid(context);
  const total = cells[0] * cells[1] * cells[2];
  assert.equal(every, 0, 'every lamp has a range: none is listed for every fragment');
  // Every (cell, slot) entry, one flag each.
  const listed = new Uint8Array(total * lamps.length);
  for (let k = 0; k < total; k++)
    for (let e = data[k]; e < data[k + 1]; e++) listed[k * lamps.length + data[e]] = 1;
  // The lamp's reach, short of single precision's error on the grid's matrix.
  const give = side * 1e-3;
  lamps.forEach(({ at, range }, slot) => {
    const reach = range - give;
    const cellOf = (d: number) =>
      [0, 1, 2].map((a) => Math.floor(m[5 * a] * (at[a] + d) + m[12 + a]));
    const lo = cellOf(-reach),
      hi = cellOf(reach);
    for (let a = 0; a < 3; a++)
      assert.ok(lo[a] >= 0 && hi[a] < cells[a], `lamp ${slot}'s reach lies inside the grid`);
    for (let k = lo[2]; k <= hi[2]; k++)
      for (let j = lo[1]; j <= hi[1]; j++)
        for (let i = lo[0]; i <= hi[0]; i++) {
          if (!sphereTouchesBox(cellBox(m, [i, j, k]), at, reach)) continue;
          const cell = (k * cells[1] + j) * cells[0] + i;
          assert.ok(listed[cell * lamps.length + slot], `lamp ${slot} in cell ${i},${j},${k}`);
        }
  });
  renderer.dispose();
  return { cells, total, side, entries: data[total] - data[0] };
}

test('past the cells per lamp, the cells widen and every lamp stays in every cell it reaches', () => {
  // Two small lamps 50 apart and one of range 30 between them: cells of the median range, 0.1,
  // would be 600×600×600 for three lamps.
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
  // 501 lamps of range 0.1 and 500 of range 20 among them: at the median range, 0.1, each wide
  // lamp would be listed in hundreds of thousands of cells, hundreds of millions of entries.
  const lamps = Array.from({ length: 1001 }, (_, i): Lamp => ({
    at: [(i % 10) * 4, Math.floor(i / 10) % 10, Math.floor(i / 100) * 4],
    range: i % 2 ? 20 : 0.1,
  }));
  const { total, side, entries } = listedEverywhere(lamps);
  assert.ok(side > 0.1, `the cells widened past the median range, to ${side}`);
  assert.ok(entries <= MOST_ENTRIES, `${entries} entries`);
  const wide = lamps.filter(({ range }) => range === 20).length;
  assert.ok(wide * total > MOST_ENTRIES / 4, 'the entries limit is the one that widened the cells');
});
