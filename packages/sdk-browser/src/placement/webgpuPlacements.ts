import { moveRootRows } from '../webgpu/pages/render/movedRoot.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import { followPlacementRows, MOVE_NONE, rootRankOfRow } from './update.ts'
import { deriveRootRows } from './rowWords.ts'
import { takeCellsMoved } from '../partition/rowCells.ts'
import type { PlacementRows } from './rows.ts'
import { linkWorldCell, waitWorldRow } from '../webgpu/pages/prepare/worldRoot.ts'
import { rootMark } from '../deformation/halfFloat.ts'

/** Hands a root that was parked or taken, or began or stopped casting, to the GPU cut. */
export const flipWorld =
  (rt: WebgpuPagesRuntime) =>
  (rank: number, root: { parked?: boolean; mark?: number; reach?: number }) => {
    rt.run.gpuSelection?.parkWorld(rank, !!root.parked)
    rt.run.gpuSelection?.markWorld(rank, rootMark(root))
    // Its rows' words say whether it casts (`MOBILITY_SHADOWLESS`): the caster passes skip them,
    // and its rows, derived again, stale the pages it left or entered (`rowCastWgsl.ts`).
    rt.lights.mobility.touch(rank)
    deriveRootRows(rt, rank)
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
 * (`../webgpu/shadow/mobility.ts`). No table is resized and nothing is prepared again.
 */
export function updateWebgpuPlacements(
  rt: WebgpuPagesRuntime,
  rows: PlacementRows,
  from: number,
  to: number,
) {
  const { run, layout, lights } = rt,
    { mobility } = lights
  // Each moved root's rows stale the pages they left and entered, its moving casters only once it
  // was moving already (`../webgpu/shadow/mobility.ts`): the rows pass derives them, row by row
  // (`rowCastWgsl.ts`); a root shown or hidden, or turned to cast or not, in place, the same
  // (`flipWorld`).
  const moved = followPlacementRows(
    layout.selectionRoots,
    rows,
    from,
    to,
    flipWorld(rt),
    (rank, world) => {
      // Weighed once: a pose that moved is taken as a move, its root named to the rows pass; one
      // within a float32 step — a parked body posed again — is none: its rows follow the world
      // sent, each appending what its own words changed (`rowCastWgsl.ts`).
      const move = !mobility.poseOf(rank)
        ? mobility.move(rank, world)
        : mobility.holds(rank, world, layout.selectionRoots[rank]?.localBox)
          ? MOVE_NONE
          : mobility.move(rank, world, true)
      if (move !== MOVE_NONE) deriveRootRows(rt, rank)
      return move
    },
    (rank) => moveRootRows(rt, layout.selectionRoots[rank], rank),
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
    // A blended row's items read its cell in their records (`ITEM_HLOD_PROXY`).
    else if (rows.blended) rt.blendState.proxiesMoved = true
    waitWorldRow(rt, rows, index, rank)
    linked = true
    return rank >= 0 || !!rows.blended
  })
  // Blend items posed by these rows read them in place: the frame only has to be drawn again,
  // and their boxes follow at its world refresh (`refreshBlendWorlds`).
  if (!moved && !linked && !rows.blended) return
  // Poses moved and rows were parked or taken: no node entered or left the source graph, so
  // the watched set stands (`frame/gateCore.ts`), and the host index already holds its worlds.
  run.gate.engineMovedInPlace()
}
