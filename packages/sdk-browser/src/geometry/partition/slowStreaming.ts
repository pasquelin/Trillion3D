/**
 * WHETHER A PARTITION'S LOAD BLOCKS ON SLOW STREAMING: the view outran the streaming of a main
 * grid compiled to wait for it (`PartitionGrid.blocks`, the job's `blockOnSlowStreaming`).
 *
 * Once the session's first image is shown — the initial load withholds every image anyway — and
 * while the setting is on (`worldStreamingBlockOnSlowStreaming`), each cell file whose main grid
 * cell is wished and not yet shown (`WorldCells.fileShown`; placed, without a world DAG), not
 * refused for good, on a main grid that blocks, is weighed by a ratio over the view's radius for
 * the grid its cell lies on (`TableCell.main`)
 * (`StreamingSource.radius`: the grid's loading range scaled, or the one radius): on a loose grid
 * (`hashSet`) the distance from the eye to the bounds it streams by, in 3D; on a square grid
 * (`spatialHash`) the distance on the ground from the eye to the centre of its square. A radius of
 * nearly zero gives the largest ratio: such a cell never blocks. A ratio at most 0 — the eye at it
 * — or below `worldStreamingBlockOnSlowStreamingRatio` blocks. The files
 * that block are the load's (`waits`): the images are withheld till each is shown
 * (`Engine.streamingBlocks`, `../../frame/loop/firstImage.ts`); meanwhile every cell wished
 * loads at once, the cap on cells loading at once (`worldStreamingMaxLoadingCells`) lifted as in
 * the initial load, and the cut turns no HLOD cell visible, shows no other file and asks no
 * warm-up (`WorldCells.blockingLoad`). The HLOD grids never block.
 *
 * Cost: O(1) per cell file wished on a main grid, each frame.
 */
import { boxPointDistance } from '../../../../math/src/geometry/boxDistance.ts'
import { length2 } from '../../../../math/src/vector/vector.ts'
import type { PartitionGrid } from '../../../../sdk-core/src/scene/core/tablePartition.ts'
import type { PartitionScheme } from '../../../../sdk-core/src/contracts/partitionOptions.ts'
import type { WorldStreaming } from '../../../../sdk-core/src/contracts/worldStreamingOptions.ts'
import type { StreamingSource } from './source.ts'
import { NEARLY_ZERO_RADIUS } from './sourceShape.ts'

/** What the weighing reads of a cell file: whether it shows — or is refused for good — and the
 *  rank of the main grid its cell lies on. */
export type SlowStreamingFiles = {
  shown(cell: number): boolean
  mainOf(cell: number): number
}

/** The weighing of a partition of `scheme` whose grids are `grids`, under the settings
 *  `streaming` holds as they stand, seen by the view `source`, its cell files read through
 *  `files`. */
export function createSlowStreaming(
  streaming: WorldStreaming,
  scheme: PartitionScheme,
  grids: readonly PartitionGrid[],
  source: StreamingSource,
  files: SlowStreamingFiles,
) {
  const loose = scheme === 'hashSet'
  const blocking = grids.some(({ main, blocks }) => main && blocks)
  /** The cell files the load waits for: refilled each frame, the same set. */
  const waits = new Set<number>()
  /** The ratio of a cell file of `grid` streaming by `bounds`, from `eye`: its distance over the
   *  view's radius for the grid: from the eye to the bounds on a loose grid, to the centre of the
   *  square on a square one. */
  const ratio = (grid: PartitionGrid, eye: ArrayLike<number>, bounds: ArrayLike<number>) => {
    const radius = source.radius(grid.range)
    if (Math.abs(radius) <= NEARLY_ZERO_RADIUS) return Infinity
    if (loose) return boxPointDistance(bounds, 0, eye[0], eye[1], eye[2]) / radius
    // The up axis dropped: the cell's square's centre, as the cell records its position.
    const x = (bounds[0] + bounds[3]) / 2,
      z = (bounds[2] + bounds[5]) / 2
    return length2(eye[0] - x, eye[2] - z) / radius
  }
  return {
    /** The cell files the load waits for this frame from `eye`, in the cells' frame, of the files
     *  `main` whose main grid cell is wished with the bounds they stream by (`waits`): none during
     *  the `initial` load, nor while nothing blocks. */
    weigh(eye: ArrayLike<number>, main: ReadonlyMap<number, ArrayLike<number>>, initial: boolean) {
      waits.clear()
      if (initial || !blocking || !streaming.blockOnSlowStreaming) return waits
      for (const [cell, bounds] of main) {
        const grid = grids[files.mainOf(cell)]
        if (!grid.blocks || files.shown(cell)) continue
        const at = ratio(grid, eye, bounds)
        if (at <= 0 || at < streaming.blockOnSlowStreamingRatio) waits.add(cell)
      }
      return waits
    },
    /** The cell files the last frame's load waits for. */
    waits: waits as ReadonlySet<number>,
    /** The load let go: it waits for nothing. */
    clear: () => waits.clear(),
  }
}
