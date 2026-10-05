// The light grid's pass on a real GPU (#1369): the shipped `lighting/tiles` WGSL — each light's run
// in each column, the two walks, the cache and the lights tested again past it, the pool — builds,
// cell by cell, lists that hold every lamp reaching a point of the cell, in increasing order, with
// the count's shadow bit where a listed lamp holds a slot; and those lists are its oracle's
// (`gpuLightGridOracle.ts`), but for a run's end moved by a rounding. 48 lamps, and 800 whose
// columns keep more than the 512 runs the cache holds.
//
//   node bench/dawn/proofs.ts tests/gpu/lighting/light-grid.gpu.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { LIGHT_SETTINGS } from '../../../packages/sdk-core/src/index.ts';
import { seeded } from '../kit/randomDraw.ts';
import {
  camera,
  pixelPoint,
  type Vec3,
} from '../../../packages/sdk-browser/src/lighting/tiles/tileCamera.fixture.ts';
import { gridSlice } from '../../../bench/oracles/browser/gpuLightGridOracle.ts';
import { gridLists, reaches } from '../../../bench/runner/lightGridWalk.ts';
import { runOnDawn, loadPage } from '../kit/onDawn.ts';
import type { GridLamp } from './lightGridPage.ts';

/** The view: cut cells on both axes. */
const [width, height] = [333, 207];
const view = camera([3, 40, -5], 0.8, -0.6, 70, width, height);
const r = seeded(1369);
/** A point of the view: pixel (x, y) at a depth between 2 m and 400 m. */
const pointAt = () => {
  const [x, y] = [Math.floor(r() * width), Math.floor(r() * height)];
  const z = Math.fround(0.1 / (2 + r() * 398));
  return { x, y, z, p: pixelPoint(view, x, y, z) };
};
/** `count` lamps about points of the view, an eighth clustered; one in ten with a shadow slot. */
const lamps = (count: number): GridLamp[] => {
  const anchor = pointAt().p;
  return Array.from({ length: count }, (_, k) => {
    const cluster = k < count / 8;
    const range = cluster ? 4 : Math.exp(Math.log(0.05) + r() * Math.log(600));
    const [centre, reach] = cluster ? [anchor, 1] : [pointAt().p, 2 * range];
    const position = centre.map((v) => Math.fround(v + (r() * 2 - 1) * r() * reach)) as Vec3;
    return { position, range: Math.fround(range), slot: k % 10 === 3 };
  });
};
const sets = [lamps(48), lamps(800)];

test('the grid pass lists every lamp reaching its cells, as its oracle does, on the GPU', async () => {
  const page = (await loadPage(
    resolve(import.meta.dirname, 'lightGridPage.ts'),
    'lightGridPage',
  )) as typeof import('./lightGridPage.ts');
  const pageErrors: string[] = [];
  const result = await runOnDawn(page.run, { view, sets }, pageErrors);
  assert.ok(!('unavailable' in result), 'WebGPU must be available');
  const { errors, runs } = result;
  assert.deepEqual([...errors, ...pageErrors], []);
  sets.forEach((set, s) => {
    const { columnsX, cells } = runs[s];
    const lights = set.map(({ position, range }) => ({ centre: position, radius: range }));
    const oracle = gridLists(view, lights);
    const cellOf = (column: number, slice: number) =>
      cells[column * LIGHT_SETTINGS.gridSlices + slice];
    /** A cell's list; with no room in the pool, every lamp of the scene. */
    const listOf = (column: number, slice: number) =>
      cellOf(column, slice).list ?? set.map((_, k) => k);
    let entries = 0,
      moved = 0;
    oracle.columns.forEach(({ lists }, column) =>
      lists.forEach((expected, slice) => {
        const { list, shadowed } = cellOf(column, slice);
        assert.ok(list, `${set.length} lamps: every column had room in the pool`);
        assert.deepEqual(
          [...list].sort((a, b) => a - b),
          list,
          'increasing order',
        );
        assert.equal(
          shadowed,
          list.some((k) => set[k].slot),
          'the shadow bit',
        );
        entries += expected.length;
        moved += expected.filter((k) => !list.includes(k)).length;
        moved += list.filter((k) => !expected.includes(k)).length;
      }),
    );
    assert.ok(moved <= entries / 1000, `${moved} of ${entries} entries moved by a rounding`);
    // Conservative on the GPU's own lists: a lamp reaching a point is in its cell's list.
    for (let k = 0; k < 4000; k++) {
      const { x, y, z, p } = pointAt();
      const column =
        Math.floor(y / LIGHT_SETTINGS.tileSize) * columnsX +
        Math.floor(x / LIGHT_SETTINGS.tileSize);
      const list = listOf(column, gridSlice(z));
      lights.forEach((light, rank) => {
        if (reaches(p, light)) assert.ok(list.includes(rank), `lamp ${rank} reaches ${x},${y}`);
      });
    }
  });
});
