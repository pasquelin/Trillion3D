/**
 * THE PLAN OF A PARTITION'S FRAME (`cells.ts`): what a frame does with the cells its view wishes
 * once the view stands where it stands.
 *
 * The wishes are planned again — the source set to the view, the plan made (`plan.ts`) — only
 * once the view moved or turned enough (`streamingUpdate.ts`); a frame between goes on with the
 * last plan, from the eye it was made from (`stood`). The HLOD actors off, no HLOD cell is held
 * nor told; the cells not activated (`worldStreamingTargetState` loaded) are told to the cut as
 * such and activate no cell of the main grid. The placed cells leave when the plan says; one whose
 * main grid cell is wished draws its source meshes, another its HLOD 0 actor (`proxy`); the HLOD
 * cells follow the plan's HLOD 0 cells.
 *
 * Cost: what the plan costs on a frame that plans, O(placed cells) on one that does not move the
 * view.
 */
import {
  activatesCells,
  type WorldStreaming,
} from '../../../../sdk-core/src/contracts/worldStreamingOptions.ts'
import type {
  PartitionGrid,
  TablePartition,
} from '../../../../sdk-core/src/scene/core/tablePartition.ts'
import type { WorldCells } from '../dag/worlds/worldCells.ts'
import type { createHlodCells } from '../hlod/hlodCells.ts'
import type { HlodPulls } from '../hlod/hlodPulls.ts'
import type { createCellPlacements } from './placements.ts'
import type { createCellPlan } from './plan.ts'
import type { createCellView } from './cellView.ts'
import type { StreamingSource } from './source.ts'
import { createStreamingUpdate } from './streamingUpdate.ts'

/** The cells of the main grid a view that only loads activates: none. */
const NOT_ACTIVATED: ReadonlyMap<number, ArrayLike<number>> = new Map()

/** What a frame's plan works on. */
type Parts = {
  streaming: WorldStreaming
  scheme: TablePartition['scheme']
  source: StreamingSource
  plan: ReturnType<typeof createCellPlan>
  pulled: Pick<HlodPulls, 'update'>
  hlod: Pick<ReturnType<typeof createHlodCells>, 'close' | 'follow' | 'visible'>
  rows: Pick<ReturnType<typeof createCellPlacements>, 'leave' | 'proxy'>
  held: ReadonlyMap<number, unknown>
  grids: readonly PartitionGrid[]
  failed: (url: string) => boolean
}

/** The plan of the frames of a partition made of `parts`. */
export function createFramePlanning(parts: Parts) {
  const { streaming, source, plan, pulled, hlod, rows, held, grids, failed } = parts
  const update = createStreamingUpdate(streaming, parts.scheme)
  /** Whether the HLOD actors were on, and the eye the last plan was made from. */
  let hlodOn = true,
    stood: ArrayLike<number> = [0, 0, 0]
  return {
    /** The plan of the frame of the view `local` (`createCellView`) at `eye` looking along `axis` in
     *  the world, the cut's world cells `cells` — none without a world DAG — drawing instance
     *  `instance`, `initial` while the initial load runs: the plan, the placed cells that leave
     *  given back to their rows. */
    run(
      local: ReturnType<ReturnType<typeof createCellView>>,
      eye: ArrayLike<number>,
      axis: ArrayLike<number> | undefined,
      cells: WorldCells | undefined,
      instance: number,
      initial: boolean,
    ) {
      const again = update.due(eye, axis, local.aim, local.moves, initial)
      if (again) source.set((stood = local.eye), local.axis, local.heading, local.velocity)
      pulled.update()
      // The HLOD actors off, no HLOD cell is held nor told, every file streams on the main grid.
      if (hlodOn && !streaming.hlod) hlod.close(cells, instance)
      hlodOn = streaming.hlod
      cells?.hlodEnabled(hlodOn)
      cells?.activated(activatesCells(streaming))
      const leaves = hlodOn && cells ? hlod : undefined
      const planned = again ? plan.plan(stood, grids, held, failed, leaves, hlodOn) : plan.replay()
      for (const cell of planned.leave) rows.leave(cell)
      // A placed cell whose main grid cell is wished draws its source meshes, one past it its HLOD
      // 0 actor: the same rows, told apart in the HLOD view (`proxy`).
      if (again) for (const cell of held.keys()) rows.proxy(cell, !planned.main.has(cell))
      if (hlodOn) hlod.follow(planned.leaves, stood, cells, instance)
      return planned
    },
    /** Whether the HLOD actors were on at the last frame. */
    get hlodOn() {
      return hlodOn
    },
    /** The eye the last plan was made from. */
    get stood() {
      return stood
    },
    /** The cells of the main grid the view activates, of those `main` it wishes: none while it asks
     *  no activation, so none holds the images back. */
    activated: (main: ReadonlyMap<number, ArrayLike<number>>) =>
      activatesCells(streaming) ? main : NOT_ACTIVATED,
    /** The frame ends, leaving work (`busy`) or none (`StreamingUpdate.end`). */
    end: update.end,
    /** The next frame's update runs, the view's wishes lost (`StreamingUpdate.reset`). */
    reset: update.reset,
  }
}
