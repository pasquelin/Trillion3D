// The light grid as its pass builds it, from its oracle (`gpuLightGridOracle.ts`): every
// column of cells, each light tested against the column's planes, the run of slices it meets solved
// for those it may meet, and each covered pixel handed its cell's list. The one walk the grid
// counters share (`lighting/lightGridCount.ts`, `lighting/resolveWorkCount.ts`, `lighting/lightTileSampledCount.ts`). COUNTED,
// never timed.
import {
  GRID,
  cellColumn,
  gridSlice,
  sphereInColumn,
  toTileFrame,
  type TileView,
} from '../../oracles/browser/gpuLightGridOracle.ts'
import { columnFrame, lightRun } from '../../oracles/browser/gpuLightGridRunOracle.ts'
import {
  pixelPoint,
  type Vec3,
} from '../../../packages/sdk-browser/src/lighting/tiles/tileCamera.fixture.ts'
import type { Light } from './lightTileCity.ts'
import { distanceSqVector3 } from '../../../packages/math/src/vector/vector.ts'
import { ceilDiv } from '../../../packages/math/src/scalar/integers.ts'

/** The pass's work: its columns and cells, a light against a column's planes, the runs solved
 *  (each at most eight section evaluations, `NEWTON_STEPS` an end), the slices marked — each a list entry. */
type GridWork = {
  columns: number
  cells: number
  columnTests: number
  solves: number
  entries: number
}

/** Each column's lists, slice by slice, the ranks in increasing order; the lights within its
 *  planes, which alone may reach its pixels; the pass's work. */
export function gridLists(view: TileView, lights: Light[], grid = GRID) {
  const [columnsX, columnsY] = [view.width, view.height].map((n) => ceilDiv(n, grid.cell))
  const cells = columnsX * columnsY * grid.slices
  const work: GridWork = {
    columns: columnsX * columnsY,
    cells,
    columnTests: 0,
    solves: 0,
    entries: 0,
  }
  const columns: { lists: number[][]; within: number[] }[] = []
  for (let cy = 0; cy < columnsY; cy++)
    for (let cx = 0; cx < columnsX; cx++) {
      const planes = cellColumn(view, [cx, cy], grid)
      const frame = columnFrame(view, [cx, cy], planes, grid)
      const lists: number[][] = Array.from({ length: grid.slices }, () => [])
      const within: number[] = []
      lights.forEach(({ centre, radius }, rank) => {
        work.columnTests++
        const at = toTileFrame(view, centre)
        if (!sphereInColumn(planes, at, radius)) return
        within.push(rank)
        work.solves++
        const run = lightRun(view, frame, at, radius, grid)
        if (!run) return
        for (let s = run[0]; s <= run[1]; s++) lists[s].push(rank)
        work.entries += run[1] - run[0] + 1
      })
      columns.push({ lists, within })
    }
  return { columns, columnsX, work }
}

/** Hands each covered pixel of `depths` its point (f64), its cell's list and the lights within its
 *  column's planes; returns the pass's work. */
export function walkGrid(
  view: TileView,
  depths: Float32Array,
  lights: Light[],
  visit: (point: Vec3, listed: number[], within: number[]) => void,
  grid = GRID,
) {
  const { columns, columnsX, work } = gridLists(view, lights, grid)
  for (let y = 0; y < view.height; y++)
    for (let x = 0; x < view.width; x++) {
      const z = depths[y * view.width + x]
      if (!(z > 0)) continue
      const { lists, within } =
        columns[Math.floor(y / grid.cell) * columnsX + Math.floor(x / grid.cell)]
      visit(pixelPoint(view, x, y, z), lists[gridSlice(z, grid)], within)
    }
  return work
}

/** Whether a light's range holds a point: its term is not an exact zero there. */
export const reaches = (p: Vec3, { centre: c, radius }: Light) =>
  distanceSqVector3(p, c) < radius * radius

/** The per-tile pass at `width` × `height` over `lights` lights: each tile
 *  of 16 pixels reads its 256 depths and tests every light against its two slices. */
export const tilePassWork = (width: number, height: number, lights: number) => {
  const tiles = ceilDiv(width, 16) * ceilDiv(height, 16)
  return { texels: width * height, tileTests: tiles * lights }
}
