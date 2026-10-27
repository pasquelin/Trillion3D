import { moveRootRows } from '../frame/render/movedRoot.ts'
import type { WebgpuPagesRuntime } from '../frame/backend/runtime.ts'
import { followPlacementRows, MOVE_NONE, rootRankOfRow } from './update.ts'
import { takeCellsMoved } from '../geometry/partition/rowCells.ts'
import type { PlacementRows } from './rows/rows.ts'
import { linkWorldCell, waitWorldRow } from '../frame/prepare/worldRoot.ts'
import { rootMark } from '../deformation/halfFloat.ts'
import type { DrawDistance, RootParent } from '../geometry/selection/types.ts'
import { askNodeRoom } from './growth/growthOf.ts'
import { shadowsFollowDrawDistance } from '../lighting/shadows/casters/followChanges.ts'

/** Hands a root that was parked or taken, or began or stopped casting, or is drawn at other
 *  distances, or has another group above its root, to the GPU cut. */
export const flipWorld =
  (rt: WebgpuPagesRuntime) =>
  (
    rank: number,
    root: {
      parked?: boolean
      mark?: number
      reach?: number
      drawDistance?: DrawDistance
      rootParent?: RootParent
    },
  ) => {
    rt.run.gpuSelection?.parkWorld(rank, !!root.parked)
    rt.run.gpuSelection?.markWorld(rank, rootMark(root))
    rt.run.gpuSelection?.drawDistanceWorld(rank, root.drawDistance)
    if (rt.run.gpuSelection?.rootParentWorld(rank, root.rootParent) === false) askNodeRoom(rt)
    // Whether it casts (`MOBILITY_SHADOWLESS`) is its mobility's: the caster passes skip it. A root
    // parked leaves its cache state: a placement that takes its row later starts static.
    if (root.parked) rt.lights.mobility.park(rank)
    rt.lights.mobility.touch(rank)
    // A row parked or taken lies in its cell, or in none, from now on (`worldRoot.ts`).
    linkWorldCell(rt, rank)
  }

/**
 * Rows of an instance buffer the WebGPU page raster was opened with were written. The roots read
 * their worlds from the rows, so nothing is copied: their boxes are reprojected, a parked row
 * leaves the GPU cut's first queue and a taken one enters it (`parkWorld`), a row that stops or
 * starts casting leaves or enters every light cut (`markWorld`), the page rows of the
 * roots that read them are rewritten, and them alone (`moveRootRows`), a row whose cell moved or
 * that was parked or taken is linked to the HLOD 0 cell it lies in (`linkWorldCell`), and the
 * frame learns that
 * poses moved — the worlds go up in one write at the next image, and the shadow pages the change
 * touched are drawn again: their moving casters only, once the placements are known to move
 * (`../lighting/shadows/casters/mobility.ts`). No table is resized and nothing is prepared again.
 */
export function updateWebgpuPlacements(
  rt: WebgpuPagesRuntime,
  rows: PlacementRows,
  from: number,
  to: number,
) {
  const { run, layout, lights } = rt,
    { mobility } = lights
  // Each moved root's pose is the mobility's to weigh: a moving caster only once it was moving
  // already (`../lighting/shadows/casters/mobility.ts`); a root shown or hidden, or turned to cast
  // or not, in place, is handed on by `flipWorld`.
  const moved = followPlacementRows(
    layout.selectionRoots,
    rows,
    from,
    to,
    flipWorld(rt),
    (rank, world) => {
      // Weighed once: a pose that moved is taken as a move; one within a float32 step — a parked
      // body posed again — is none: the world sent is the one drawn.
      const move = !mobility.poseOf(rank)
        ? mobility.move(rank, world)
        : mobility.holds(rank, world, layout.selectionRoots[rank]?.localBox)
          ? MOVE_NONE
          : mobility.move(rank, world, true)
      return move
    },
    (rank, distant, reseated) => {
      // A row seated on another mesh is another primitive: it arrives anew (`mobility.reseat`).
      if (reseated) mobility.reseat(rank)
      moveRootRows(rt, layout.selectionRoots[rank], rank)
      if (distant) shadowsFollowDrawDistance(rt, rank)
    },
    layout,
  )
  // A row its cell placed or left lies in that cell's HLOD 0 cell now, or none (`worldRoot.ts`). A
  // row no root reads yet keeps its note for the growth that brings its root, its cell counting it
  // as a placement not resident meanwhile (`waitWorldRow`), unless the blend pass draws its buffer:
  // no root may ever read it. A link moved is drawn by the next image, even still.
  let linked = false
  takeCellsMoved(rows, (index) => {
    const rank = rootRankOfRow(layout.selectionRoots, rows, index)
    if (rank >= 0) linkWorldCell(rt, rank)
    // A blended row's items read its cell in their records (`ITEM_HLOD`).
    else if (rows.blended) rt.blendState.proxiesMoved = true
    waitWorldRow(rt, rows, index, rank)
    linked = true
    return rank >= 0 || !!rows.blended
  })
  // Blend items posed by these rows read them in place: the frame only has to be drawn again,
  // and their boxes follow at its world refresh (`refreshBlendWorlds`).
  if (!moved && !linked && !rows.blended) return
  // Poses moved and rows were parked or taken: no node entered or left the source graph, so
  // the watched set stands (`frame/gate/gateCore.ts`), and the host index already holds its worlds.
  run.gate.engineMovedInPlace()
}
