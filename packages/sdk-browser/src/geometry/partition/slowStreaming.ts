/**
 * WHETHER A PARTITION'S LOAD BLOCKS ON SLOW STREAMING: the view outran the streaming of a main grid
 * compiled to wait for it (`PartitionGrid.blocks`, the job's `blockOnSlowStreaming`).
 *
 * Once the session's first image is shown — the initial load withholds every image anyway — and
 * while the setting is on (`worldStreamingBlockOnSlowStreaming`), each cell file whose main grid
 * cell is wished and not yet shown (`WorldCells.fileShown`; placed, without a world DAG), not
 * refused for good, is weighed by a ratio over the view's radius for the grid
 * (`StreamingSource.radius`: the grid's loading range scaled, or the one radius): on a loose grid
 * (`hashSet`) the distance from the eye to the bounds it streams by, in 3D; on a square grid
 * (`spatialHash`) the distance on the ground from the eye to the centre of its square. A radius of
 * nearly zero gives the largest ratio: such a cell never blocks. A ratio at most 0 — the eye at it
 * — or below `worldStreamingBlockOnSlowStreamingRatio` blocks. The files
 * that block are the load's (`waits`): the images are withheld till each is shown
 * (`Engine.streamingBlocks`, `../../frame/loop/firstImage.ts`); meanwhile they load, as many at
 * once as block, a unit already loading goes on and no other starts, and the cut turns no HLOD
 * cell visible, shows no other file and asks no warm-up (`WorldCells.blockingLoad`). The HLOD
 * grids never block.
 *
 * Cost: O(1) per cell file wished on the main grid, each frame.
 */
import { boxPointDistance } from '../../../../math/src/geometry/boxDistance.ts'
import type { PartitionGrid } from '../../../../sdk-core/src/scene/core/tablePartition.ts'
import type { PartitionScheme } from '../../../../sdk-core/src/contracts/partitionOptions.ts'
import type { WorldStreaming } from '../../../../sdk-core/src/contracts/worldStreamingOptions.ts'
import type { StreamingSource } from './source.ts'

/** What the weighing reads of a cell file: whether it shows — or is refused for good. */
export type SlowStreamingFiles = {
  shown(cell: number): boolean
}

/** The radius under which a ratio is the largest one, as the reference's safe division
 *  (`FMath::SafeDivide`, `IsNearlyZero`). */
const NEARLY_ZERO = 1e-8

/** The weighing of a partition of `scheme` whose main grid is `grid`, under the settings
 *  `streaming` holds as they stand, seen by the view `source`, its cell files read through
 *  `files`. */
export function createSlowStreaming(
  streaming: WorldStreaming,
  scheme: PartitionScheme,
  grid: PartitionGrid,
  source: StreamingSource,
  files: SlowStreamingFiles,
) {
  const loose = scheme === 'hashSet'
  /** The cell files the load waits for: refilled each frame, the same set. */
  const waits = new Set<number>()
  /** The ratio of a cell file streaming by `bounds`, from `eye`: its distance over the view's
   *  radius for the grid, as the reference weighs it (`UWorldPartitionRuntimeCellData`,
   *  `UWorldPartitionRuntimeCellDataSpatialHash::AppendStreamingSourceInfo`). */
  const ratio = (eye: ArrayLike<number>, bounds: ArrayLike<number>) => {
    const radius = source.radius(grid.range)
    if (Math.abs(radius) <= NEARLY_ZERO) return Infinity
    if (loose) return boxPointDistance(bounds, 0, eye[0], eye[1], eye[2]) / radius
    // The up axis dropped: the cell's square's centre, as the cell records its position.
    const x = (bounds[0] + bounds[3]) / 2,
      z = (bounds[2] + bounds[5]) / 2
    return Math.hypot(eye[0] - x, eye[2] - z) / radius
  }
  return {
    /** The cell files the load waits for this frame from `eye`, in the cells' frame, of the files
     *  `main` whose main grid cell is wished with the bounds they stream by (`waits`): none during
     *  the `initial` load, nor while nothing blocks. */
    weigh(eye: ArrayLike<number>, main: ReadonlyMap<number, ArrayLike<number>>, initial: boolean) {
      waits.clear()
      if (initial || !grid.blocks || !streaming.blockOnSlowStreaming) return waits
      for (const [cell, bounds] of main) {
        if (files.shown(cell)) continue
        const at = ratio(eye, bounds)
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

export type SlowStreaming = ReturnType<typeof createSlowStreaming>
