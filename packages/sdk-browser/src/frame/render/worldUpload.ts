import { rootWorlds, rootWorldsMoved } from '../../geometry/dag/pack/packWorlds.ts'
import { invalidateOccluderHistory } from '../io/drops.ts'
import { blendSource, followHostVisibility } from '../../placement/hidden.ts'
import { noteKeyRecord } from '../../blend/keyRecords.ts'
import { flipWorld } from '../../placement/webgpuPlacements.ts'
import { resized } from '../../../../math/src/sequence/resized.ts'
import { noteRootWorld } from '../../placement/roots/rootWorlds.ts'
import { worldMoved } from '../../geometry/selection/rootWorld.ts'
import { finishMoves, noteMoved } from './movedBatch.ts'
import { composeHostWrites } from '../../placement/compose/gpuComposeState.ts'
import { appendRootsUnder, appendUnder } from './movedNode.ts'
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'

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
 * (`../../geometry/dag/shader/worldPoseWgsl.ts`). A frame's CPU follows what moved, never the
 * world's placements.
 */
export function uploadWorlds(rt: WebgpuPagesRuntime) {
  const { run } = rt,
    { selectionRoots, worldUpdates } = rt.layout
  const write = run.gate.updateWorlds(rt.setup.worlds, (nodes) => noteMoved(rt, nodes))
  const reshaped = !!write && write.reshaped
  // The deformation's staleness noted before this refresh (`pending`, read by the hold) compared
  // the worlds the host has since rewritten: the frame's `update` reads them again.
  if (write) rt.vis.deformation?.frame.forget()
  // The poses the host wrote: their roots' worlds, boxes and motion, the revision already bumped.
  if (write && !reshaped) finishMoves(rt, false)
  // A cut made beside the running one takes every world at its swap (`replayMoves`).
  if (reshaped && run.movedWorlds.since) run.movedWorlds.since.walked = true
  followFlips(rt, reshaped, write ? write.flipped : undefined)
  const worldsMoved = run.worldUploadRevision !== run.gate.revisions.scene
  rt.timing.worldCounts.rootsUploaded = 0
  if (!worldsMoved) return false
  run.worldUploadRevision = run.gate.revisions.scene
  // The placements a call or a host write moved, each named beside its rows' write
  // (`movedWorlds.ts`): their worlds alone go up — a write that moved no pose, a light dimmed, names
  // none and sends nothing. A scene that changed shape names none: every one does. The GPU cut
  // says which poses its send moved (`updateWorlds`) — without one, those named, or those a scan
  // finds.
  const named = run.movedWorlds.take(),
    selection = run.gpuSelection
  // A host write lands on the cut's worlds of the roots it moved, composed ones included: the
  // composition writes theirs again, they alone (`composeHostWrites`).
  if (!reshaped) {
    rootWorlds(worldUpdates, selectionRoots, named)
    rt.timing.worldCounts.rootsUploaded = named.length
    const moved = selection && named.length ? selection.updateWorlds(worldUpdates, named) : named
    composeHostWrites(rt, moved)
    return true
  }
  const moved = reshapedMoves(rt, selection)
  composeHostWrites(rt, moved)
  // A scene that changed shape names no root: every world is sent again, the decode of the clusters
  // reads them on the GPU.
  if (moved.length) {
    // Each moved root's world version moves: its box, stretch and winding are taken again.
    // Its world goes up to the roots' doubles too, and its box is derived again (the shadows' diff).
    for (const rank of moved) {
      worldMoved(selectionRoots[rank])
      noteRootWorld(rt, rank)
    }
    invalidateOccluderHistory(run)
  }
  return true
}

// A node the host hid or showed parks its roots and hides its blend items, or takes them back,
// in every cut, and one set to cast or not leaves or enters every light cut; the shadow pages its
// roots covered are drawn again, by their placements (`flipWorld`), static casters included unless they
// were moving already: the static layer never held those (`../../lighting/shadows/casters/mobility.ts`).
function followFlips(
  rt: WebgpuPagesRuntime,
  reshaped: boolean,
  flipped: readonly Object3D[] | undefined,
) {
  if (!(reshaped || (flipped && flipped.length))) return
  const { blendState } = rt,
    { selectionRoots } = rt.layout
  // A blend item hidden or shown rewrites the drawn bit of its key record (`keyRecords.ts`).
  followHostVisibility(
    selectionRoots,
    {
      entries: blendState.blendGpu,
      sourceOf: blendSource,
      flipped: (_, rank) => noteKeyRecord(blendState, rank),
    },
    flipWorld(rt),
    flipped && !reshaped ? underFlipped(rt, flipped) : undefined,
    rt.layout.viewHidden,
  )
}

/** The roots a reshaped scene moved the poses of, their worlds written for the GPU cut. */
function reshapedMoves(
  rt: WebgpuPagesRuntime,
  selection: WebgpuPagesRuntime['run']['gpuSelection'],
) {
  const { selectionRoots, worldUpdates } = rt.layout
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
  return moved
}

/** The roots and the see-through draws under the nodes `flipped`, read in the tree
 *  (`appendUnder`) — one under two listed twice, its second read leaving it as the first —:
 *  what a flip reads, none other. */
function underFlipped(rt: WebgpuPagesRuntime, flipped: readonly Object3D[]) {
  const { blendState } = rt,
    blend = blendState.blendGpu,
    { blendIndex } = blendState
  let rootCount = 0,
    blendCount = 0
  for (const node of flipped) {
    rootCount = appendRootsUnder(rt.layout, node, flippedRoots, rootCount)
    blendCount = appendUnder(blend, blendSource, node, flippedBlend, blendCount, blendIndex)
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
