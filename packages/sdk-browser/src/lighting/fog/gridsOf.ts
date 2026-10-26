import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { cellGrid, type FogGrid } from './layout.ts'

/** What the grids are kept in: the key the textures' grid was made for and the grid, and the cells the view uses of it. */
interface GridHistory {
  resource: { key: number[]; grid: FogGrid }
  view: { -readonly [K in keyof FogGrid]: FogGrid[K] }
}

/** The grid of a volume not yet made: one cell. */
export const NO_GRID: FogGrid = { x: 1, y: 1, z: 1, pixelSize: 1 }

/** The cells of the textures for targets of `allocated` pixels at the cell side and depth a quality
 *  names — the one held while those hold, made again when one changes — and the cells the view of
 *  `width × height` pixels uses of them, the same side. */
export function gridsOf<H extends GridHistory>(
  history: H,
  { width, height }: { width: number; height: number },
  allocated: readonly [number, number],
  knobs: { cellSize: number; sliceCount: number },
  maxDimension: number,
) {
  const { key } = history.resource
  const { cellSize, sliceCount } = knobs
  if (
    key[0] !== allocated[0] ||
    key[1] !== allocated[1] ||
    key[2] !== cellSize ||
    key[3] !== sliceCount
  ) {
    history.resource.grid = cellGrid(allocated[0], allocated[1], cellSize, sliceCount, maxDimension)
    key[0] = allocated[0]
    key[1] = allocated[1]
    key[2] = cellSize
    key[3] = sliceCount
  }
  const { grid } = history.resource
  const { view } = history
  view.x = Math.min(ceilDiv(width, grid.pixelSize), grid.x)
  view.y = Math.min(ceilDiv(height, grid.pixelSize), grid.y)
  view.z = grid.z
  view.pixelSize = grid.pixelSize
  return history
}
