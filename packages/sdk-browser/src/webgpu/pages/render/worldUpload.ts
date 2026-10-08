import { rootWorlds, rootWorldsMoved } from '../../../gpu/dag/pack.ts'
import { invalidateOccluderHistory } from '../io/drops.ts'
import type { EngineCamera } from '../../../camera/world.ts'
import { followHostVisibility } from '../../../placement/hidden.ts'
import { flipWorld } from '../../../placement/webgpuPlacements.ts'
import { takeMovedWorlds } from './movedWorlds.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'

/**
 * Brings the scene's world matrices to the image. A world matrix is a function of the scene alone:
 * an image that nothing touched would find them all identical. The engine index is therefore only
 * recomputed at a scene-revision change, and a node that `setWebgpuTransform` just moved has
 * already recomputed it — and rewritten its own rows (`movedRoot.ts`). Only a host write, whose
 * moved roots nobody named, walks it here, and then rewrites every row the GPU cut reads. Returns
 * whether the poses moved.
 *
 * A camera that moves sends nothing: the cut's worlds are held in single precision with
 * their exact translations beside them, and brought to the eye on the GPU before the cut reads
 * them (`../../../gpu/dag/worldRebase.ts`), the eye the cut and the compose pass work at being
 * `worldUploadOrigin`. A frame's CPU follows what moved, never the world's placements.
 */
export function uploadWorlds(rt: WebgpuPagesRuntime, cam: EngineCamera) {
  const { run } = rt,
    { selectionRoots, worldUpdates, rows } = rt.layout
  const hostWalked = run.gate.updateWorlds(rt.setup.worlds)
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
  run.worldUploadOrigin.set(cam.eye)
  const worldsMoved = run.worldUploadRevision !== run.gate.revisions.scene
  rt.timing.worldCounts.rootsRebased = 0
  if (!worldsMoved) return false
  run.worldUploadRevision = run.gate.revisions.scene
  // The placements a call moved, each named beside its rows' write (`movedWorlds.ts`): their
  // worlds alone go up. A host walk named none: every one does.
  const named = takeMovedWorlds(run.movedWorlds)
  // The impostor cards follow the same moves: those named, or every root after a host walk.
  rt.gpu?.impostors?.worldsMoved(hostWalked ? undefined : named)
  if (!hostWalked) {
    rootWorldsAt(worldUpdates, selectionRoots, named)
    rt.timing.worldCounts.rootsRebased = named.length
    if (named.length) run.gpuSelection?.updateWorlds(worldUpdates, named)
    return true
  }
  rt.timing.worldCounts.rootsRebased = selectionRoots.length
  // A host write that moved no pose — a light dimmed — keeps the table: the worlds it sends are
  // the ones the cut holds, bit for bit, whatever the eye.
  const posesMoved = rootWorldsMoved(worldUpdates, selectionRoots)
  rootWorlds(worldUpdates, selectionRoots)
  const posted = run.gpuSelection?.updateWorlds(worldUpdates)
  // A host write names no root: every row's world matrix, the only shared input to a row the
  // scene can still change after `prepare()`, is written again. The GPU cut compares the worlds it
  // holds: one that found them all unchanged — the host wrote a light, not a pose — keeps the table.
  if (posted !== false && posesMoved) {
    rows.tableEpoch++
    invalidateOccluderHistory(run)
  }
  return true
}

/** The worlds of the placements of `ranks` taken into `worlds` (`rootWorlds`), and no other. */
function rootWorldsAt(
  worlds: Float32Array,
  roots: WebgpuPagesRuntime['layout']['selectionRoots'],
  ranks: Int32Array,
) {
  for (const rank of ranks) if (roots[rank]) worlds.set(roots[rank].world.elements, rank * 16)
}
