/**
 * THE HLOD CELLS ABOVE HLOD 0 FILED ON THE GROUND, so that a frame finds the cells within each
 * grid's reach of the eye without walking the chain (`hlodCells.ts`): per grid, buckets as wide as
 * the view's reach on that grid, each cell in every bucket its streaming bounds meet — the cells
 * within that reach of an eye lie in the 3 × 3 buckets around it at most.
 */
import type { WorldRootsHold } from './worldRoots.ts'
import type { StreamingSource } from '../partition/source.ts'
import { NO_CELLS } from '../partition/coarser.ts'
import type { PartitionGrid } from '../../../../sdk-core/src/scene/core/tablePartition.ts'
import { BOX_VALUES } from '../../../../math/src/geometry/box.ts'
import { appendTo, entryOf } from '../../../../math/src/sequence/counts.ts'

/** A bucket's key from its two coordinates: exact while each lies within ±2²⁵. */
const bucketKey = (ix: number, iz: number) => (ix + 0x2000000) * 0x4000000 + (iz + 0x2000000)

/**
 * Per grid, the cells of `chain` above HLOD 0 filed on the ground in buckets as wide as the view's
 * reach on that grid (`StreamingSource.radius` of `grids`' range), each in every bucket its
 * streaming bounds meet (`near`). Filed for the reaches the source gives now: once one moved — a
 * streaming setting changed — they are stale (`stale`).
 */
export function createGridBuckets(
  chain: NonNullable<WorldRootsHold['table']>['chain'],
  grids: readonly PartitionGrid[],
  source: StreamingSource,
) {
  const { bounds, level, grid: gridOf } = chain,
    count = level.length
  const reaches = grids.map(({ range }) => source.radius(range))
  const filed = new Map<number, { side: number; buckets: Map<number, number[]> }>()
  const newGrid = (grid: number) => ({ side: reaches[grid], buckets: new Map<number, number[]>() })
  for (let cell = 0; cell < count; cell++) {
    // A grid the view reaches nowhere streams no cell.
    const side = reaches[gridOf[cell]]
    if (level[cell] === 0 || !(side > 0)) continue
    const grid = entryOf(filed, gridOf[cell], newGrid)
    const { buckets } = grid,
      at = BOX_VALUES * cell
    for (let ix = Math.floor(bounds[at] / side); ix <= Math.floor(bounds[at + 3] / side); ix++)
      for (
        let iz = Math.floor(bounds[at + 2] / side);
        iz <= Math.floor(bounds[at + 5] / side);
        iz++
      ) {
        appendTo(buckets, bucketKey(ix, iz), cell)
      }
  }
  /** The frame each cell was last met at by `near`: a cell filed in several buckets once. */
  const metAt = new Uint32Array(count)
  let frame = 0
  return {
    /** Whether the view's reach on a grid moved since they were filed. */
    stale: () => grids.some(({ range }, at) => reaches[at] !== source.radius(range)),
    /** The grids that hold cells above HLOD 0. */
    grids: () => filed.keys(),
    /** Each cell of grid `at` the view's shape for that grid meets from `(x, z)` on the ground
     *  (`StreamingSource.meets`), told to `visit` once. */
    near(at: number, x: number, z: number, visit: (cell: number) => void) {
      const grid = filed.get(at)
      if (!grid) return
      frame++
      const { side, buckets } = grid,
        shape = grids[at]
      for (let ix = Math.floor((x - side) / side); ix <= Math.floor((x + side) / side); ix++)
        for (let iz = Math.floor((z - side) / side); iz <= Math.floor((z + side) / side); iz++) {
          for (const cell of buckets.get(bucketKey(ix, iz)) ?? NO_CELLS) {
            if (metAt[cell] === frame) continue
            metAt[cell] = frame
            if (source.meets(bounds, BOX_VALUES * cell, shape)) visit(cell)
          }
        }
    },
  }
}
