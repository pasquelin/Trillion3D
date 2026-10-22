import { type ResidencyChanges, type SelectionUniforms } from '../../../gpu/core/selection.ts'
import type { createDagResidencyUpload } from '../residencyUpload.ts'
import type { createDagDispatch } from '../dispatch.ts'
import { readFor } from '../dispatchRead.ts'
import type { createDifferenceChain } from '../differenceChain.ts'
import type { DagRuntimeState } from './runtimeState.ts'
import type { DagResources } from '../resources.ts'
import { MAIN_VIEW, sameCut } from '../swap/swap.ts'
import type { TreeFollower, TreeLeaves } from '../tree/treeFollow.ts'
import type { RecordTexture } from '../../../gpu/core/recordTexture.ts'
import type { ProxyInstances } from '../proxy/proxyInstances.ts'
import type { LinkFollower } from '../worlds/worldFollow.ts'
import type { PageResidency } from '../../../gpu/core/selection.ts'
import { NO_INDEX } from '../../../../../math/src/constants.ts'
import {
  DRAW_DISTANCE_MARK,
  DRAW_FAR_WORD,
  DRAW_NEAR_WORD,
  MARK_WORD,
  ROOT_PARENT_MARK,
  ROOT_PARENT_WORD,
  ROOT_PARENT_WORDS,
  ROOT_WORD,
  writeRootParent,
} from '../frameTable.ts'
import { markWithdraws } from '../placement/placementTree.ts'
import { f32Bits } from '../../../../../math/src/float/bits.ts'
import type { DrawDistance, RootParent } from '../../selection/types.ts'

/** What a camera cut's methods share (`runtime.ts`): its tables, its state, the difference chain,
 *  the residency upload, the tree's and the world cells' followers, and the main view's dispatch. */
export type DagRun = ReturnType<typeof createDagDispatch> & {
  resources: DagResources
  state: DagRuntimeState
  chain: ReturnType<typeof createDifferenceChain>
  uploadResidency: ReturnType<typeof createDagResidencyUpload>
  /** The placement tree's follower (`../tree/treeFollow.ts`), none without a tree. */
  tree: TreeFollower | undefined
  /** The run-time cuts' instances, one a placement (`../proxy/proxyInstances.ts`). */
  proxies: ProxyInstances
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
export function parkRoot({ resources, state, tree, proxies }: DagRun, w: number, parked: boolean) {
  const { packed, frames } = resources
  const node = parked ? NO_INDEX : packed.rootBases[w]
  if (packed.rootNodes[w] === node) return
  packed.rootNodes[w] = node
  frames.writeWord(w, ROOT_WORD, node)
  proxies.park(w, parked)
  tree?.touch(w)
  voidCuts(state, true)
}

/** Primitive `w`'s mark, as `parkRoot`. */
export function writeMark({ resources, state, tree, proxies }: DagRun, w: number, mark: number) {
  const { packed, frames } = resources
  const before = packed.mark[w]
  if (before === mark) return
  packed.mark[w] = mark
  frames.writeWord(w, MARK_WORD, mark)
  proxies.mark(w, mark)
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
 * its two frame words, the mark bit that says it names one, the distances' column (made by the
 * first placement that names one), and the tree's group refit again, which holds their nearest and
 * farthest. A cut in hand chose pages under the old distances: void. Nothing when it is the
 * distance it has.
 */
export function writeDrawDistance(run: DagRun, w: number, distance: DrawDistance | undefined) {
  const { resources, state, tree } = run,
    { packed, frames } = resources
  const near = distance?.min ?? 0,
    far = distance?.max ?? 0
  if (!packed.drawDistance && far <= 0) return
  const held = (packed.drawDistance ??= new Float32Array(2 * Math.max(1, packed.worldCount)))
  if (held[2 * w] === near && held[2 * w + 1] === far) return
  held[2 * w] = near
  held[2 * w + 1] = far
  frames.writeWord(w, DRAW_NEAR_WORD, f32Bits(near))
  frames.writeWord(w, DRAW_FAR_WORD, f32Bits(far))
  const mark = packed.mark[w]
  writeMark(run, w, far > 0 ? mark | DRAW_DISTANCE_MARK : mark & ~DRAW_DISTANCE_MARK)
  tree?.touch(w)
  voidCuts(state, true)
}

/**
 * Placement `w` an instance of an assembly whose root's group is `parent` from now on, none for a
 * placement that is no instance (`DagRoot.rootParent`): its five frame words, the mark bit that
 * says it names a parent, and the parents' column (made by the first placement that names one). A
 * cut in hand chose pages under the old parent: void. Nothing when it is the parent it has.
 */
export function writeRootParentWords(run: DagRun, w: number, parent: RootParent | undefined) {
  const { resources, state } = run,
    { packed, frames } = resources
  if (!packed.rootParent && !parent) return
  const held = (packed.rootParent ??= new Float32Array(
    ROOT_PARENT_WORDS * Math.max(1, packed.worldCount),
  ))
  const next = new Float32Array(ROOT_PARENT_WORDS)
  writeRootParent(next, 0, parent)
  const at = ROOT_PARENT_WORDS * w
  if (next.every((word, k) => word === held[at + k])) return
  held.set(next, at)
  next.forEach((word, k) => frames.writeWord(w, ROOT_PARENT_WORD + k, f32Bits(word)))
  const mark = packed.mark[w]
  writeMark(run, w, parent ? mark | ROOT_PARENT_MARK : mark & ~ROOT_PARENT_MARK)
  voidCuts(state, true)
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
  const { swap } = resources,
    { cuts } = swap
  let held = false
  const again = (asked: SelectionUniforms) =>
    !state.dead &&
    !state.disposed &&
    (!!state.reshape || (held && !sameCut(swap, MAIN_VIEW, asked, state)))
  for (const asked = cuts[MAIN_VIEW - 1]?.uniforms; asked && again(asked);) {
    const serial = swap.cut
    cut(asked)
    await state.pending
    held = swap.cut === serial
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
