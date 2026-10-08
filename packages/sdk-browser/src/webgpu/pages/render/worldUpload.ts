import { rootWorlds, rootWorldsMoved } from '../../../gpu/dag/pack.ts'
import { invalidateOccluderHistory } from '../io/drops.ts'
import { followHostVisibility } from '../../../placement/hidden.ts'
import { flipWorld } from '../../../placement/webgpuPlacements.ts'
import { takeSorted } from '../../cut/denseKeys.ts'
import { resized } from '../../../../../math/src/sequence/resized.ts'
import { finishMoves, noteMoved } from './movedBatch.ts'
import { appendRootsUnderSlot, appendUnderSlot } from './movedNode.ts'
import { Object3D } from '../../../../../sdk-core/src/world/object/object3d.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'

/**
 * Brings the scene's world matrices to the image. A world matrix is a function of the scene alone:
 * an image that nothing touched would find them all identical. The engine index is therefore only
 * recomputed at a scene-revision change, and a node that `setWebgpuTransform` just moved has
 * already recomputed it — and rewritten its own rows (`movedRoot.ts`). A host write is followed
 * the same way: the nodes it wrote, as the scene watch heard them, name the roots under them
 * (`noteMoved`), whose rows alone are rewritten and whose worlds alone go up; the nodes it showed,
 * hid or set to cast or not flip the roots under them alone. Only a scene that changed shape walks
 * every root, and then rewrites every row the GPU cut reads. Returns whether the poses moved.
 *
 * A camera that moves sends nothing: the cut's worlds are held in single precision with their
 * exact translations beside them, and each cut reads a translation at its own eye
 * (`../../../gpu/dag/shader/worldPoseWgsl.ts`). A frame's CPU follows what moved, never the
 * world's placements.
 */
export function uploadWorlds(rt: WebgpuPagesRuntime) {
  const { run } = rt,
    { selectionRoots, worldUpdates, rows } = rt.layout
  const write = run.gate.updateWorlds(rt.setup.worlds, (nodes) => noteMoved(rt, nodes))
  const reshaped = !!write && write.reshaped
  // The deformation's staleness noted before this refresh (`pending`, read by the hold) compared
  // the worlds the host has since rewritten: the frame's `update` reads them again.
  if (write) rt.vis.deformation?.frame.forget()
  // The poses the host wrote: their roots' rows, boxes and motion, the revision already bumped.
  if (write && !reshaped) finishMoves(rt, false)
  // A cut made beside the running one takes every world at its swap (`replayMoves`).
  if (reshaped && run.movedWorlds.since) run.movedWorlds.since.walked = true
  // A node the host hid or showed parks its roots and hides its blend items, or takes them back,
  // in every cut, and one set to cast or not leaves or enters every light cut; the shadow pages its
  // roots covered are drawn again, static casters included unless every root that flipped was
  // moving already: the static layer never held those (`../../shadow/mobility.ts`).
  if (reshaped || (write && write.flipped.length)) {
    const blend = rt.blendState.blendGpu
    const flipped = followHostVisibility(
      selectionRoots,
      { entries: blend, sourceOf: blendSource },
      flipWorld(rt),
      rt.lights.mobility.moves,
      reshaped ? undefined : underFlipped(rt, write.flipped),
    )
    if (flipped) rt.lights.changes.worldChanged(flipped.min, flipped.max, flipped.movingOnly)
  }
  const worldsMoved = run.worldUploadRevision !== run.gate.revisions.scene
  rt.timing.worldCounts.rootsUploaded = 0
  if (!worldsMoved) return false
  run.worldUploadRevision = run.gate.revisions.scene
  // The placements a call or a host write moved, each named beside its rows' write
  // (`movedWorlds.ts`): their worlds alone go up — a write that moved no pose, a light dimmed, names
  // none and sends nothing. A scene that changed shape names none: every one does. The GPU cut
  // says which poses its send moved (`updateWorlds`) — without one, those named, or those a scan
  // finds —, and the impostor cards follow those alone.
  const named = takeSorted(run.movedWorlds),
    selection = run.gpuSelection,
    cards = rt.gpu?.impostors
  if (!reshaped) {
    rootWorlds(worldUpdates, selectionRoots, named)
    rt.timing.worldCounts.rootsUploaded = named.length
    const moved = selection && named.length ? selection.updateWorlds(worldUpdates, named) : named
    cards?.worldsMoved(moved)
    return true
  }
  rt.timing.worldCounts.rootsUploaded = selectionRoots.length
  // A reshape that moved no pose keeps the table. The GPU cut compares the worlds it holds with
  // those sent, and says so; without one, the host scans.
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
  // A scene that changed shape names no root: every row's world matrix, the only shared input to
  // a row the scene can still change after `prepare()`, is written again.
  if (moved.length) {
    rows.tableEpoch++
    invalidateOccluderHistory(run)
  }
  return true
}

/** The roots and the see-through draws under the nodes `flipped`, read in the tree
 *  (`appendUnderSlot`) — one under two listed twice, its second read leaving it as the first —:
 *  what a flip reads, none other. */
function underFlipped(rt: WebgpuPagesRuntime, flipped: readonly Object3D[]) {
  const roots = rt.layout.selectionRoots,
    blend = rt.blendState.blendGpu
  let rootCount = 0,
    blendCount = 0
  for (const node of flipped) {
    const tree = Object3D._treeOf(node)
    rootCount = appendRootsUnderSlot(roots, tree, node.index, flippedRoots, rootCount)
    blendCount = appendUnderSlot(blend, blendSource, tree, node.index, flippedBlend, blendCount)
  }
  under.roots.count = rootCount
  under.seeThrough.count = blendCount
  return under
}
const flippedRoots: number[] = [],
  flippedBlend: number[] = []
const under = {
  roots: { ranks: flippedRoots, count: 0 },
  seeThrough: { ranks: flippedBlend, count: 0 },
}
/** The source node of a see-through draw. */
const blendSource = (item: { sourceMesh?: unknown }) => item.sourceMesh as Object3D | undefined
