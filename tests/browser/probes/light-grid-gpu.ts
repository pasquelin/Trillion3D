// The light grid's pass on a real GPU (#1369): the shipped `lighting/tiles` WGSL — each light's run
// in each column, the two walks, the cache and the lights tested again past it, the pool — builds,
// cell by cell, lists that hold every lamp reaching a point of the cell, in increasing order, with
// the count's shadow bit where a listed lamp holds a slot; and those lists are its oracle's
// (`gpuLightGridOracle.ts`), but for a run's end moved by a rounding. 48 lamps, and 800 whose
// columns keep more than the 512 runs the cache holds.
//
//   node --experimental-strip-types --test tests/browser/probes/light-grid-gpu.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIGHT_SETTINGS } from '../../../packages/sdk-core/src/index.ts';
import { seeded } from '../../../site/examples/kit/random.ts';
import {
  camera,
  pixelPoint,
  type Vec3,
} from '../../../packages/sdk-browser/src/lighting/tiles/tileCamera.fixture.ts';
import { gridSlice } from '../../../bench/oracles/browser/gpuLightGridOracle.ts';
import { gridLists, reaches } from '../../../bench/runner/lightGridWalk.ts';
import { dansPageWebgpu, bundlePage } from './pageWebgpu.ts';
import { GRID_VIEW, type GridLamp, type run } from './lightGridPage.ts';

declare global {
  var lightGrid: { run: typeof run };
}

if (import.meta.main) {
  const here = dirname(fileURLToPath(import.meta.url));
  const { eye, yaw, pitch, fov, width, height } = GRID_VIEW;
  const view = camera([...eye], yaw, pitch, fov, width, height);
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
    const script = await bundlePage(resolve(here, 'lightGridPage.ts'), 'lightGrid');
    const pageErrors: string[] = [];
    const result = await dansPageWebgpu(
      (list: GridLamp[][]) => globalThis.lightGrid.run(list),
      sets,
      {
        titre: 'Light grid',
        script,
        erreursPage: pageErrors,
      },
    );
    assert.equal(result.unavailable, undefined, 'WebGPU must be available');
    const { errors, runs } = result as Exclude<typeof result, { unavailable: string }>;
    assert.deepEqual([...errors, ...pageErrors], []);
    sets.forEach((set, s) => {
      const { columnsX, cells } = runs[s];
      const lights = set.map(({ position, range }) => ({ centre: position, radius: range }));
      const oracle = gridLists(view, lights);
      const listOf = (column: number, slice: number) =>
        cells[column * LIGHT_SETTINGS.gridSlices + slice].list ?? set.map((_, k) => k);
      let entries = 0,
        moved = 0;
      oracle.columns.forEach(({ lists }, column) =>
        lists.forEach((expected, slice) => {
          const { list, shadowed } = cells[column * LIGHT_SETTINGS.gridSlices + slice];
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
}
