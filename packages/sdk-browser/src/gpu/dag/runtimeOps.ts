import { type ResidencyChanges, type SelectionUniforms } from '../core/selection.ts'
import {
  refreshMovedStretch,
  changedWorlds,
  worldChangedAt,
  writePrimitiveWords,
} from './worlds.ts'
import { resized } from '../../../../math/src/sequence/resized.ts'
import type { createDagResidencyUpload } from './residencyUpload.ts'
import type { createDagPoolList } from './poolList.ts'
import type { createDagDispatch } from './dispatch.ts'
import { readFor } from './dispatchRead.ts'
import type { createDifferenceChain } from './differenceChain.ts'
import type { DagRuntimeState } from './runtimeState.ts'
import type { DagResources } from './resources.ts'
import type { createWorldResidencyMirror } from './residencyMirror.ts'
import { MAIN_VIEW } from './swap.ts'
import { appendDagRoots, type DagAppended } from './pack.ts'
import { writeParts, writeRanges } from './split.ts'
import {
  COLD_WORDS,
  CLUSTER_WORDS,
  groupParentBase,
  keyGroupBase,
  keyWordBase,
  recordKeyBase,
} from './layout.ts'
import { DAG_NODE_FLOATS, type DagRoot } from './types.ts'
import { uploadNodes, type TreeFollower } from './treeFollow.ts'
import type { ProxyInstances } from './proxyInstances.ts'
import type { LinkFollower } from './worldFollow.ts'
import type { PageResidency } from '../core/selection.ts'
import { NO_INDEX } from '../../../../math/src/constants.ts'

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

/** Cuts in hand and in flight name pages the kernel may no longer choose: they are void. */
function voidCuts(state: DagRuntimeState) {
  state.residencyRevision++
  state.last = null
}

/** `GpuSelection.updateWorlds`: the placements sent, compared with the last ones — every one, or
 *  those of `named` alone (`updateNamedWorlds`) —; those whose pose moved. */
export function updateRuntimeWorlds(run: DagRun, next: Float32Array, named?: Int32Array) {
  const { resources, state } = run,
    { packed, frames } = resources
  if (state.disposed || state.dead) return NO_RANKS
  if (next.byteLength !== packed.worlds.byteLength) throw new Error('GPU_SCENE_WORLD_COUNT_CHANGED')
  if (named) return updateNamedWorlds(run, next, named)
  const origins = frames.writeWorldOrigins()
  run.proxies.worldsWritten(origins)
  // `packed.worlds` is what this selection last received, and only this method writes it:
  // the worlds the next send is compared with, without a second copy of them beside it. The rows
  // whose read words moved go up, they alone: a translation goes up through the origins.
  // The live placements alone, the room a growth keeps left out.
  const live = packed.worldSources.length
  movedScratch = resized(movedScratch, live)
  const moved = changedWorlds(packed.worlds, next, movedScratch, live)
  return posesMoved(run, sendMoved(run, next, moved), origins)
}

/** No placement moved. */
const NO_RANKS = new Int32Array(0)

/** The placements whose pose moved: the `moved` first of `movedScratch` — their read words — and
 *  `origins` — their exact translation —, each increasing, joined in one pass into the run's list,
 *  each once. One moved: the cuts in hand and in flight keep their revision and still name what
 *  to stream. */
function posesMoved(run: DagRun, moved: number, origins: Int32Array) {
  const n = origins.length
  if (!moved && !n) return NO_RANKS
  const into = (run.moves = resized(run.moves, moved + n))
  let i = 0,
    j = 0,
    count = 0
  while (i < moved || j < n) {
    const a = i < moved ? movedScratch[i] : Infinity,
      b = j < n ? origins[j] : Infinity
    into[count++] = Math.min(a, b)
    if (a <= b) i++
    if (b <= a) j++
  }
  run.state.worldRevision++
  const ranks = into.subarray(0, count)
  // The tree follows the poses the send moved, a host walk's as a call's.
  run.tree?.moved(ranks)
  return ranks
}

/** The placements that moved among those of `named`, those whose stretch moved with them, and the
 *  one an unlink writes again. */
let movedScratch = new Int32Array(8),
  stretchedScratch = new Int32Array(8)
const rewritten = new Int32Array(1)

/**
 * The placements of `named`, increasing — the ones a call moved —, compared with the worlds last
 * received and those that moved sent, each run to its range, with their exact translations and,
 * where the linear part moved, their stretch: a frame's CPU and upload follow what moved, never
 * the placements' count. Each cut reads a translation at its own eye from the exact one
 * (`shader/worldPoseWgsl.ts`): a translation that alone moved writes its doubles alone. The ranks
 * the packing holds are kept once, here: every step below reads them alone.
 */
function updateNamedWorlds(run: DagRun, next: Float32Array, all: Int32Array) {
  const { packed, frames } = run.resources
  let held = all.length
  while (held && all[held - 1] >= packed.worldSources.length) held--
  const named = held === all.length ? all : all.subarray(0, held)
  const origins = frames.writeWorldOrigins(named)
  // A translation alone is no cut's matrix word: the proxy mirrors it from the origins.
  run.proxies.worldsWritten(origins)
  movedScratch = resized(movedScratch, named.length)
  let moved = 0
  for (const w of named) if (worldChangedAt(packed.worlds, next, w)) movedScratch[moved++] = w
  return posesMoved(run, sendMoved(run, next, moved), origins)
}

/** The `moved` first placements of `movedScratch`, whose read words moved: their stretch
 *  refreshed where their linear part moved, before their copy (`refreshMovedStretch`), their
 *  worlds copied into those held and sent, each run to its range, with the rows whose stretch
 *  moved; their count. */
function sendMoved(run: DagRun, next: Float32Array, moved: number) {
  const { packed, frames, frameData } = run.resources
  stretchedScratch = resized(stretchedScratch, moved)
  const stretched = refreshMovedStretch(
    packed.worlds,
    next,
    packed,
    frameData,
    movedScratch,
    moved,
    stretchedScratch,
  )
  for (let i = 0; i < moved; i++) {
    const w = movedScratch[i]
    packed.worlds.set(next.subarray(w * 16, w * 16 + 16), w * 16)
  }
  if (moved) {
    frames.writeNamedWorlds(packed.worlds, movedScratch, moved)
    run.proxies.worldsWritten(movedScratch, moved)
  }
  if (stretched) frames.writeNamedRows(stretchedScratch, stretched)
  return moved
}

/** `GpuSelection.composedPlacement`, unlinked: placement `w`'s parent no longer poses it, and the
 *  pose it composed on the GPU — words the host never wrote — is replaced by the host's own, its
 *  world and its exact translation written again whatever the caches held. */
export function rewritePlacement({ resources, state, proxies }: DagRun, w: number) {
  const { packed, frames } = resources
  if (w >= packed.worldSources.length) return
  frames.forgetOrigin(w)
  rewritten[0] = w
  frames.writeWorldOrigins(rewritten)
  frames.writeNamedWorlds(packed.worlds, rewritten, 1)
  proxies.worldsWritten(rewritten, 1)
  // Its stretch too: the GPU's composition wrote the one of the pose its parent gave it.
  frames.writeNamedRows(rewritten, 1)
  state.worldRevision++
}

/** `GpuSelection.appendRoots`: roots packed behind the others, their words sent. */
export function appendRoots(run: DagRun, roots: readonly DagRoot[]) {
  const { resources, state, uploadResidency, tree } = run
  if (state.disposed || state.dead || state.growing) return false
  const added = appendDagRoots(resources.packed, roots)
  if (!added) return false
  // Their nodes' open counts first: the node words go up once, with them.
  uploadResidency.append()
  writeAppended(resources, added)
  // Their groups are fitted at the next cut, over the leaves of the placements they hold.
  const [first, end] = added.worlds
  for (let w = first; w < end; w++) tree?.touch(w)
  run.proxies.appended(first, end)
  run.proxies.worldsRange(first, end)
  voidCuts(state)
  return true
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
  // The root travels behind the stretch in the frame buffer (`resources.ts`).
  frames.writeWord(w, 1, node)
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
  // The mark travels behind the record shift (`primitiveFrameWords`).
  frames.writeWord(w, 3, mark)
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

/** What `appendDagRoots` wrote, sent: the appended placements' primitive words, frame rows, worlds
 *  and origins, and the placement tree's nodes and member words they joined. Nothing else of the
 *  tables moved: their nodes, records and content keys are their primitives', already there. */
function writeAppended(resources: DagResources, added: DagAppended) {
  const { device, packed, nodeParts, coldParts, clusterParts, frames, frameData } = resources,
    cones = packed.pageCones
  const send = (target: typeof nodeParts, source: Float32Array, from: number, bytes: number) =>
    bytes > 0 &&
    writeParts(device, target, from, source.buffer as ArrayBuffer, source.byteOffset + from, bytes)
  const [w0, w1] = added.worlds
  const tree = packed.placementTree,
    [m0, m1] = added.tree.members
  // The primitives it brought: their nodes, hot and cold records, the keys their records read by
  // and the key words they named or moved — written once, as a packing of every root wrote them.
  const [n0, n1] = added.nodes,
    [r0, r1] = added.records,
    nodeBytes = DAG_NODE_FLOATS * 4
  send(nodeParts, packed.nodes, n0 * nodeBytes, (n1 - n0) * nodeBytes)
  send(clusterParts, packed.clusters, r0 * CLUSTER_WORDS * 4, (r1 - r0) * CLUSTER_WORDS * 4)
  const coldAt = packed.shared!.coldAt!
  send(coldParts, cones, (coldAt + r0 * COLD_WORDS) * 4, (r1 - r0) * COLD_WORDS * 4)
  send(coldParts, cones, (recordKeyBase(packed.pageCount) + r0) * 4, (r1 - r0) * 4)
  // The keys' words and groups, each table's in the cut's one run writer's ranges.
  if (added.keys.length) {
    const keys = Int32Array.from(new Set(added.keys)).sort(),
      words = new Uint32Array(cones.buffer, cones.byteOffset, cones.length)
    for (const base of [keyWordBase(packed), keyGroupBase(packed)])
      writeRanges(device, coldParts, keys, keys.length, {
        data: words,
        sourceBase: base,
        targetBase: base,
        stride: 1,
      })
  }
  // The key groups they made: the parent starts of each, and the edges behind the live ones.
  const parentAt = groupParentBase(packed),
    [g0, g1] = added.groups,
    [e0, e1] = added.edges
  send(coldParts, cones, (parentAt + g0 + 1) * 4, (g1 - g0) * 4)
  send(coldParts, cones, (parentAt + packed.groupCount + 1 + e0) * 4, (e1 - e0) * 4)
  // The tree nodes joined, in the run writer's ranges.
  uploadNodes(device, nodeParts, packed, added.tree.nodes)
  if (tree) send(coldParts, cones, (tree.members + m0) * 4, (m1 - m0) * 4)
  for (let w = w0; w < w1; w++) writePrimitiveWords(frameData, packed, w)
  frames.writeRows(w0, w1)
  // The appended placements' worlds, one range, and their exact translations, they alone.
  frames.writeWorlds(packed.worlds, w0, w1)
  const appended = new Int32Array(w1 - w0)
  for (let k = 0; k < appended.length; k++) appended[k] = w0 + k
  frames.writeWorldOrigins(appended)
}
