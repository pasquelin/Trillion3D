import { type ResidencyChanges, type SelectionUniforms } from '../../../gpu/core/selection.ts'
import type { createDagResidencyUpload } from '../residencyUpload.ts'
import type { createDagDispatch } from '../dispatch.ts'
import { readFor } from '../dispatchRead.ts'
import type { DagRuntimeState } from './runtimeState.ts'
import type { DagResources } from '../resources.ts'
import { MAIN_VIEW, sameCut } from '../owner/cutOwner.ts'
import type { TreeFollower, TreeLeaves } from '../tree/treeFollow.ts'
import type { RecordTexture } from '../../../gpu/core/recordTexture.ts'
import type { PlacementBoxesTracker } from '../placement/placementBoxes.ts'
import type { LinkFollower } from '../worlds/worldFollow.ts'
import type { PageResidency } from '../../../gpu/core/selection.ts'
import { NO_INDEX } from '../../../../../math/src/constants.ts'
import {
  DRAW_FAR_WORD,
  DRAW_MARKS,
  DRAW_NEAR_WORD,
  drawDistanceMarks,
  MARK_WORD,
  PARENT_WORD,
  ROOT_PARENT_MARK,
  ROOT_WORD,
} from '../frameTable.ts'
import { placeParentNode, takesParents } from '../pack/packParents.ts'
import { DRAW_DISTANCE_STRIDE, sameDrawDistanceAt, writeDrawDistanceAt } from '../drawDistance.ts'
import { DAG_NODE_FLOATS } from '../types.ts'
import { markWithdraws } from '../placement/placementTree.ts'
import { f32Bits } from '../../../../../math/src/float/bits.ts'
import type { DrawDistance, RootParent } from '../../selection/types.ts'

/** What a camera cut's methods share (`runtime.ts`): its tables, its state, the residency upload,
 *  the tree's and the world cells' followers, and the main view's dispatch. */
export type DagRun = ReturnType<typeof createDagDispatch> & {
  resources: DagResources
  state: DagRuntimeState
  uploadResidency: ReturnType<typeof createDagResidencyUpload>
  /** The placement tree's follower (`../tree/treeFollow.ts`), none without a tree. */
  tree: TreeFollower | undefined
  /** The placements' world boxes (`../placement/placementBoxes.ts`). */
  boxes: PlacementBoxesTracker
  /** The world cells' follower (`../worlds/worldFollow.ts`), none without a world DAG. */
  links: LinkFollower | undefined
  /** The placements a send moved, each once, increasing (`posesMoved`). */
  moves: Int32Array
}

/** What a session writes of its roots on the GPU before every cut on the tables (`syncTables`):
 *  their worlds, boxes and stretches — into `frames`, the cut's own frame words, the stretch's one
 *  writer (`../../../placement/roots/rootPasses.ts`) —, then the tree's leaves. */
export type RootsOnGpu = { roots(frames: RecordTexture): void; leaves?: TreeLeaves }

/** The cut made from here differs. `withdrawn`: cuts in hand and in flight name pages the kernel
 *  may no longer choose — a page left, the roots changed —, and they are void; a residency that
 *  only gained pages leaves them adoptable. */
export function voidCuts(state: DagRuntimeState, withdrawn: boolean) {
  state.residencyRevision++
  if (!withdrawn) return
  state.withdrawnRevision++
  state.last = null
}

/** `GpuSelection.updateResidency`: the pool's residency, which the world's cells read too. */
export function updateRuntimeResidency(
  { resources, state, uploadResidency, links }: DagRun,
  next: PageResidency,
  changes?: ResidencyChanges,
  moved?: (page: number) => void,
) {
  if (state.disposed || state.dead) return false
  // Each cell's readiness follows the rows: its actor's roots and its placements' (`../worlds/worldFollow.ts`).
  links?.residency(next, changes)
  // The pages its roots hold, never more than its tables are laid out for.
  if (next.length > resources.pageCount) throw new Error('GPU_SELECTION_RESIDENCY_COUNT_CHANGED')
  const uploaded = uploadResidency(next, changes, moved)
  if (!uploaded) return false
  voidCuts(state, uploaded === 'withdrawn')
  return true
}

/** Primitive `w`'s root parked or put back. The cut in hand holds pages the new word no longer
 *  lets through, or lacks some it does: another cut from here. */
export function parkRoot({ resources, state, tree, boxes }: DagRun, w: number, parked: boolean) {
  const { packed, frames } = resources
  const node = parked ? NO_INDEX : packed.rootBases[w]
  if (packed.rootNodes[w] === node) return
  packed.rootNodes[w] = node
  frames.writeWord(w, ROOT_WORD, node)
  boxes.mark(w)
  tree?.touch(w)
  voidCuts(state, true)
}

/** Primitive `w`'s mark, as `parkRoot`. */
export function writeMark({ resources, state, tree }: DagRun, w: number, mark: number) {
  const { packed, frames } = resources
  const before = packed.mark[w]
  if (before === mark) return
  packed.mark[w] = mark
  frames.writeWord(w, MARK_WORD, mark)
  tree?.marked(w, before)
  // A reach alone only grows or shrinks the root's bounds: a grown one cuts again, the cut in hand
  // still adoptable; a shrunk one draws a little more until the next cut and cuts nothing — a
  // deformed root's reach moves every frame it deforms. Half bits of a positive reach order as
  // their values.
  if (markWithdraws(before, mark)) voidCuts(state, true)
  else if (mark >>> 16 > before >>> 16) voidCuts(state, false)
}

/**
 * Placement `w` drawn at `distance` from now on, none for every distance (`DagRoot.drawDistance`):
 * its two frame words, the mark bits that say it names one (`DRAW_MARKS`), the distances' column
 * (made by the first placement that names one), and the tree's group refit again, which holds
 * their nearest and farthest. A cut in hand chose pages under the old distances: void. Nothing when
 * it is the distance it has.
 */
export function writeDrawDistance(run: DagRun, w: number, distance: DrawDistance | undefined) {
  const { resources, state, tree } = run,
    { packed, frames } = resources
  if (!packed.drawDistance && !distance) return
  const held = (packed.drawDistance ??= new Float32Array(DRAW_DISTANCE_STRIDE * packed.mark.length))
  if (sameDrawDistanceAt(held, w, distance)) return
  writeDrawDistanceAt(held, w, distance)
  frames.writeWord(w, DRAW_NEAR_WORD, f32Bits(distance?.min ?? 0))
  frames.writeWord(w, DRAW_FAR_WORD, f32Bits(distance?.max ?? 0))
  writeMark(run, w, (packed.mark[w] & ~DRAW_MARKS) | drawDistanceMarks(distance))
  tree?.touch(w)
  voidCuts(state, true)
}

/**
 * Placement `w` an instance of an assembly whose root's group is `parent` from now on, none for a
 * placement that is no instance (`DagRoot.rootParent`): the node that holds the group
 * (`pack/packParents.ts`), written and sent when no placement read the group before, its frame
 * word and the mark bit that says it names one. A cut in hand chose pages under the old parent:
 * void. Nothing when it is the parent it has. False when the cut cannot take the group — its tree's
 * leaves are narrow (`takesParents`) or the group is new and the node table has no room for its
 * node: the placement names none for now — it opens whatever the group says — and the session is
 * to make a cut that can (`GpuSelection.rootParentWorld`).
 */
export function writeRootParentWords(run: DagRun, w: number, parent: RootParent | undefined) {
  const { resources, state, tree } = run,
    { packed, frames } = resources
  if (!packed.parentNode && !parent) return true
  if (parent && !takesParents(packed)) return false
  const held = (packed.parentNode ??= new Uint32Array(Math.max(1, packed.worldCount)).fill(
    NO_INDEX,
  ))
  const node = parent ? parentNodeOnGpu(resources, parent) : NO_INDEX
  if (held[w] !== node) {
    held[w] = node
    frames.writeWord(w, PARENT_WORD, node)
    const mark = packed.mark[w]
    writeMark(run, w, node === NO_INDEX ? mark & ~ROOT_PARENT_MARK : mark | ROOT_PARENT_MARK)
    // Its leaf holds the group's ball (`PARENT_LEAF`): written again, its group fitted again.
    tree?.touch(w)
    voidCuts(state, true)
  }
  return !parent || node !== NO_INDEX
}

/** The node that holds `parent` (`placeParentNode`), sent to the node table when it was written
 *  now; `NO_INDEX` when it is new and the packing has no room for it. */
function parentNodeOnGpu({ packed, cutTables }: DagResources, parent: RootParent) {
  const { parentNodes, live } = packed
  if (!live) return NO_INDEX
  const before = live.nodes,
    node = placeParentNode({ nodes: packed.nodes, live, parentNodes }, parent)
  if (node === undefined) return NO_INDEX
  const bytes = DAG_NODE_FLOATS * 4
  if (live.nodes > before)
    cutTables.nodes.target('Node')(
      before * bytes,
      packed.nodes.buffer as ArrayBuffer,
      packed.nodes.byteOffset + before * bytes,
      bytes,
    )
  return node
}

/** `GpuSelection.flush`: the reads in flight drained, the lists laid out again for caps the session
 *  asked and the cut made again on them, the cut made again under the poses in place. */
export async function flushRuntime(
  { resources, state }: DagRun,
  /** The main view's cut under `uniforms`, the tables synced first: no image of its own. */
  cut: (uniforms: SelectionUniforms) => void,
) {
  await state.pending
  // Caps asked since the lists were laid out lay them out again (`../queueGrowth.ts`): the drain
  // makes them, then cuts again on them, rather than hand back the cut before. A turn whose cut
  // the tables held while they were made (`tablesHeld`) cut nothing: the next turn cuts on the new
  // ones.
  const { owner } = resources,
    { cuts } = owner
  let held = false
  const again = (asked: SelectionUniforms) =>
    !state.dead &&
    !state.disposed &&
    (!!state.reshape || (held && !sameCut(owner, MAIN_VIEW, asked, state)))
  for (const asked = cuts[MAIN_VIEW - 1]?.uniforms; asked && again(asked);) {
    const serial = owner.serial
    cut(asked)
    await state.pending
    held = owner.serial === serial
  }
  // The cut submitted on the residency in place, whatever the poses: never `sameCut`.
  const submitted = cuts[MAIN_VIEW - 1]
  if (
    !state.dead &&
    submitted &&
    submitted.residency === state.residencyRevision &&
    !readFor(state, submitted.uniforms)
  ) {
    // Cut again under the poses in place: a drain never hands back one they have left.
    cut(submitted.uniforms)
    await state.pending
  }
  const last = state.dead ? null : state.last
  return last?.worldRevision === state.worldRevision ? last.result : null
}
