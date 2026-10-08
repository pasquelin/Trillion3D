import { rootWorlds, rootWorldsMoved } from '../../../gpu/dag/pack.ts'
import { invalidateOccluderHistory } from '../io/drops.ts'
import { followHostVisibility } from '../../../placement/hidden.ts'
import { flipWorld } from '../../../placement/webgpuPlacements.ts'
import { takeSorted } from '../../cut/denseKeys.ts'
import { resized } from '../../../../../math/src/sequence/resized.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'

/**
 * Brings the scene's world matrices to the image. A world matrix is a function of the scene alone:
 * an image that nothing touched would find them all identical. The engine index is therefore only
 * recomputed at a scene-revision change, and a node that `setWebgpuTransform` just moved has
 * already recomputed it — and rewritten its own rows (`movedRoot.ts`). Only a host write, whose
 * moved roots nobody named, walks it here, and then rewrites every row the GPU cut reads. Returns
 * whether the poses moved.
 *
 * A camera that moves sends nothing: the cut's worlds are held in single precision with their
 * exact translations beside them, and each cut reads a translation at its own eye
 * (`../../../gpu/dag/shader/worldPoseWgsl.ts`). A frame's CPU follows what moved, never the
 * world's placements.
 */
export function uploadWorlds(rt: WebgpuPagesRuntime) {
  const { run } = rt,
    { selectionRoots, worldUpdates, rows } = rt.layout
  const hostWalked = run.gate.updateWorlds(rt.setup.worlds)
  // A cut made beside the running one takes every world at its swap (`replayMoves`).
  if (hostWalked && run.movedWorlds.since) run.movedWorlds.since.walked = true
  // The deformation's staleness noted before this refresh (`pending`, read by the hold) compared
  // the worlds the host has since rewritten: the frame's `update` reads them again.
  if (hostWalked) rt.vis.deformation?.frame.forget()
  // A node the host hid or showed parks its roots and hides its blend items, or takes them back,
  // in every cut, and one set to cast or not leaves or enters every light cut; the shadow pages its
  // roots covered are drawn again, static casters included unless every root that flipped was
  // moving already: the static layer never held those (`../../shadow/mobility.ts`).
  if (hostWalked) {
    const flipped = followHostVisibility(
      selectionRoots,
      { entries: rt.blendState.blendGpu, sourceOf: (item) => item.sourceMesh },
      flipWorld(rt),
      rt.lights.mobility.moves,
    )
    if (flipped) rt.lights.changes.worldChanged(flipped.min, flipped.max, flipped.movingOnly)
  }
  const worldsMoved = run.worldUploadRevision !== run.gate.revisions.scene
  rt.timing.worldCounts.rootsUploaded = 0
  if (!worldsMoved) return false
  run.worldUploadRevision = run.gate.revisions.scene
  // The placements a call moved, each named beside its rows' write (`movedWorlds.ts`): their
  // worlds alone go up. A host walk named none: every one does. The GPU cut says which poses its
  // send moved (`updateWorlds`) — without one, those named, or those a scan finds —, and the
  // impostor cards follow those alone.
  const named = takeSorted(run.movedWorlds),
    selection = run.gpuSelection,
    cards = rt.gpu?.impostors
  if (!hostWalked) {
    rootWorlds(worldUpdates, selectionRoots, named)
    rt.timing.worldCounts.rootsUploaded = named.length
    const moved = selection && named.length ? selection.updateWorlds(worldUpdates, named) : named
    cards?.worldsMoved(moved)
    return true
  }
  rt.timing.worldCounts.rootsUploaded = selectionRoots.length
  // A host write that moved no pose — a light dimmed — keeps the table. The GPU cut compares the
  // worlds it holds with those sent, and says so; without one, the host scans.
  let moved: Int32Array
  if (selection) {
    rootWorlds(worldUpdates, selectionRoots)
    moved = selection.updateWorlds(worldUpdates)
  } else {
    const scanned = (rt.layout.worldsScanned = resized(
      rt.layout.worldsScanned,
      selectionRoots.length,
    ))
    moved = rootWorldsMoved(worldUpdates, selectionRoots, scanned)
    rootWorlds(worldUpdates, selectionRoots)
  }
  cards?.worldsMoved(moved)
  // A host write names no root: every row's world matrix, the only shared input to a row the
  // scene can still change after `prepare()`, is written again.
  if (moved.length) {
    rows.tableEpoch++
    invalidateOccluderHistory(run)
  }
  return true
}
