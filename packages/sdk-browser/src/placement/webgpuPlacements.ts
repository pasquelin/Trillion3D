import { moveRootRows } from '../webgpu/pages/render/movedRoot.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import { followPlacementRows, MOVE_NONE, rootRankOfRow } from './update.ts'
import { deriveRootRows } from './rowWords.ts'
import { takeCellsMoved } from '../partition/rowCells.ts'
import { placedBy, type PlacementRows } from './rows.ts'
import { linkWorldObject } from '../webgpu/pages/prepare/worldRoot.ts'

/** Hands a root that was parked or taken, or began or stopped casting, to the GPU cut. */
export const flipWorld =
  (rt: WebgpuPagesRuntime) => (rank: number, root: { parked?: boolean; mark?: number }) => {
    rt.run.gpuSelection?.parkWorld(rank, !!root.parked)
    rt.run.gpuSelection?.markWorld(rank, root.mark ?? 0)
    // Its rows' words say whether it casts (`MOBILITY_SHADOWLESS`): the caster passes skip them,
    // and its rows, derived again, stale the pages it left or entered (`rowCastWgsl.ts`).
    rt.lights.mobility.touch(rank)
    deriveRootRows(rt, rank)
    // A row parked or taken draws its object, or none, from now on (`worldRoot.ts`).
    linkWorldObject(rt, rank)
  }

/**
 * Rows of an instance buffer the WebGPU page raster was opened with were written. The roots read
 * their worlds from the rows, so nothing is copied: their boxes are reprojected, a parked row
 * leaves the GPU cut's first queue and a taken one enters it (`parkWorld`), a row that stops or
 * starts casting leaves or enters every light cut (`markWorld`), the page rows of the
 * roots that read them are rewritten, and them alone (`moveRootRows`), a row whose cell moved or
 * that was parked or taken is linked to the world object it draws (`linkWorldObject`), and the
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
      // Weighed once: a pose that moved is taken as a move, its rows' shadow change asked; one its
      // shadows hold — a parked body posed again within a float32 step — derives its rows alone.
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
  // Whether the blend pass draws these rows, asked once and only when needed.
  let blended: boolean | undefined
  const drawnBlended = () => (blended ??= placedBy(rt.blendState.blendGpu, rows))
  // A row its cell placed or left draws that cell's object now, or none (`worldRoot.ts`). A row no
  // root reads yet keeps its note for the growth that brings its root, unless the blend pass draws
  // its buffer: no root may ever read it.
  takeCellsMoved(rows, (index) => {
    const rank = rootRankOfRow(layout.selectionRoots, rows, index)
    if (rank >= 0) linkWorldObject(rt, rank)
    return rank >= 0 || drawnBlended()
  })
  // Blend items posed by these rows read them in place: the frame only has to be drawn again,
  // and their boxes follow at its world refresh (`refreshBlendWorlds`).
  if (!moved && !drawnBlended()) return
  // Poses moved and rows were parked or taken: no node entered or left the source graph, so
  // the watched set stands (`frame/gateCore.ts`), and the host index already holds its worlds.
  run.gate.engineMovedInPlace()
}
