// The light grid as the tile pass builds it (#1369), from its oracle (`gpuLightGridOracle.ts`):
// every column of cells, each light tested against the column, then against each cell of its span
// of depth slices, and each covered pixel handed its cell's list. The one walk the grid counters
// share (`lightGridCount.ts`, `resolveWorkCount.ts`, `lightTileCount.ts`). COUNTED, never timed.
import {
  GRID,
  cellBounds,
  cellColumn,
  cellHit,
  columnFrame,
  lightRun,
  gridSlice,
  sliceSpan,
  sphereInColumn,
  toTileFrame,
  type TileView,
} from '../oracles/browser/gpuLightGridOracle.ts';
import { pixelPoint, type Vec3 } from '../../packages/sdk-browser/src/lighting/tiles/tileCamera.fixture.ts';
import type { Light } from './lightTileCity.ts';

/** Each column's lists, slice by slice, the ranks in increasing order; and the pass's tests. */
export function gridLists(view: TileView, lights: Light[], grid = GRID) {
  const [columnsX, columnsY] = [view.width, view.height].map((n) => Math.ceil(n / grid.cell));
  const work = { columns: columnsX * columnsY, cells: columnsX * columnsY * grid.slices, columnTests: 0, cellTests: 0, columnKept: 0 };
  const lists: number[][][] = [];
  for (let cy = 0; cy < columnsY; cy++)
    for (let cx = 0; cx < columnsX; cx++) {
      const cell: [number, number] = [cx, cy];
      const column = cellColumn(view, cell, grid);
      const slices: number[][] = Array.from({ length: grid.slices }, () => []);
      const bounds: ReturnType<typeof cellBounds>[] = [];
      const frame = columnFrame(view, cell, column, grid);
      lights.forEach(({ centre, radius }, rank) => {
        work.columnTests++;
        const at = toTileFrame(view, centre);
        if (!sphereInColumn(column, at, radius)) return;
        const run = lightRun(view, frame, at, radius, grid);
        if (!run) return;
        const [first, last] = run;
        if (process.env.NOREFINE) { work.columnKept++; for (let s = first; s <= last; s++) slices[s].push(rank); return; }
        const hit = (s: number) => {
          work.cellTests++;
          bounds[s] ??= cellBounds(view, cell, s, column, grid);
          return cellHit(bounds[s], at, radius);
        };
        // The cells a sphere meets in a column are a run of slices: the sphere and the column are
        // convex, so are their common points, whose depths are an interval. Its two ends are
        // searched; the slices between them are listed untested.
        let front = first;
        while (front <= last && !hit(front)) front++;
        if (front > last) return;
        work.columnKept++;
        let back = last;
        while (back > front && !hit(back)) back--;
        for (let s = front; s <= back; s++) slices[s].push(rank);
      });
      lists.push(slices);
    }
  return { lists, columnsX, work };
}

/** Hands each covered pixel of `depths` its point (f64) and its cell's list; the pass's work. */
export function walkGrid(
  view: TileView,
  depths: Float32Array,
  lights: Light[],
  visit: (point: Vec3, listed: number[]) => void,
  grid = GRID,
) {
  const { lists, columnsX, work } = gridLists(view, lights, grid);
  for (let y = 0; y < view.height; y++)
    for (let x = 0; x < view.width; x++) {
      const z = depths[y * view.width + x];
      if (!(z > 0)) continue;
      const column = Math.floor(y / grid.cell) * columnsX + Math.floor(x / grid.cell);
      visit(pixelPoint(view, x, y, z), lists[column][gridSlice(z, grid)]);
    }
  return work;
}

/** Whether a light's range holds a point: its term is not an exact zero there. */
export const reaches = (p: Vec3, { centre: c, radius }: Light) =>
  (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2 < radius ** 2;
