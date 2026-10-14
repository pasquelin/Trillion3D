import { type ResidencyChanges, type SelectionUniforms } from '../core/selection.ts'
import type { createDagResidencyUpload } from './residencyUpload.ts'
import type { createDagPoolList } from './poolList.ts'
import type { createDagDispatch } from './dispatch.ts'
import { readFor } from './dispatchRead.ts'
import type { createDifferenceChain } from './differenceChain.ts'
import type { DagRuntimeState } from './runtimeState.ts'
import type { DagResources } from './resources.ts'
import type { createWorldResidencyMirror } from './residencyMirror.ts'
import { MAIN_VIEW } from './swap.ts'
import type { TreeFollower, TreeLeaves } from './treeFollow.ts'
import type { RecordTexture } from '../core/recordTexture.ts'
import type { ProxyInstances } from './proxyInstances.ts'
import type { LinkFollower } from './worldFollow.ts'
import type { PageResidency } from '../core/selection.ts'
import { NO_INDEX } from '../../../../math/src/constants.ts'
import { MARK_WORD, ROOT_WORD } from './frameTable.ts'

/** What a camera cut's methods share (`runtime.ts`): its tables, its state, the difference chain,
 *  the residency upload, the pool list, the world mirror, the tree's and links' followers, and the
 *  main view's dispatch. */
export type DagRun = ReturnType<typeof createDagDispatch> & {
  resources: DagResources
  state: DagRuntimeState
  chain: ReturnType<typeof createDifferenceChain>
  uploadResidency: ReturnType<typeof createDagResidencyUpload>
  poolList: ReturnType<typeof createDagPoolList>
  mirror: ReturnType<typeof createWorldResidencyMirror> | undefined
  /** The placement tree's follower (`treeFollow.ts`), none without a tree. */
  tree: TreeFollower | undefined
  /** The run-time cuts' instances, one a placement (`proxyInstances.ts`). */
  proxies: ProxyInstances
  /** The world links' follower (`worldFollow.ts`), none without a world DAG. */
  links: LinkFollower | undefined
  /** Told of each placement whose link moved (`GpuSelection.linkMoved`). */
  linkMoved: ((world: number) => void) | undefined
  /** The placements a send moved, each once, increasing (`posesMoved`). */
  moves: Int32Array
}

/** What a session writes of its roots on the GPU before every cut on the tables (`syncTables`):
 *  their worlds, boxes and stretches — into `frames`, the cut's own frame words, the stretch's one
 *  writer (`../../placement/rootPasses.ts`) —, then the tree's leaves. */
export type RootsOnGpu = { roots(frames: RecordTexture): void; leaves?: TreeLeaves }

/** Cuts in hand and in flight name pages the kernel may no longer choose: they are void. */
export function voidCuts(state: DagRuntimeState) {
  state.residencyRevision++
  state.last = null
}

/** `GpuSelection.updateResidency`: the pool's residency, through the world mirror when one packs. */
export function updateRuntimeResidency(
  { resources, state, uploadResidency, mirror, links }: DagRun,
  next: PageResidency,
  changes?: ResidencyChanges,
  moved?: (page: number) => void,
) {
  // The links moved since reach the mirror before the rows it mirrors.
  links?.residency(next)
  if (state.disposed || state.dead) return false
  if (mirror) ({ flags: next, changes } = mirror.update(next, changes))
  // The pages its roots hold, never more than its tables are laid out for.
  if (next.length > resources.pageCount) throw new Error('GPU_SELECTION_RESIDENCY_COUNT_CHANGED')
  if (!uploadResidency(next, changes, moved)) return false
  voidCuts(state)
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
  voidCuts(state)
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
  voidCuts(state)
}

/** `GpuSelection.flush`: the reads in flight drained, a list grown or a cut coarsened and the cut
 *  made again on it, the cut made again under the poses in place. */
export async function flushRuntime(
  { resources, state }: DagRun,
  /** The main view's cut under `uniforms`, the tables synced first: no image of its own. */
  cut: (uniforms: SelectionUniforms) => void,
) {
  await state.pending
  // A cut past its list grows it, a cut that dropped work its queues or lists (`queueGrowth.ts`),
  // or past the device it coarsens (`listCap.ts`): the drain grows them, then cuts again on them,
  // rather than hand back the cut before; a factor that moved back cuts again under it too. It
  // rises √2 at least to its coarsest, and falls only to a factor that did not overflow for the
  // view as it stands (`coarsening.ts`): the drain ends.
  const { cuts } = resources.swap
  const again = () => (state.grow || state.growFlags || state.factorMoved) && !state.dead
  for (const asked = cuts[MAIN_VIEW - 1]?.uniforms; asked && again();) {
    cut(asked)
    await state.pending
    cut(asked)
    await state.pending
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
