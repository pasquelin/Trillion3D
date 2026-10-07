import {
  SELECTION_NONE as NONE,
  type GpuSelection,
  type ResidencyChanges,
} from '../core/selection.ts'
import { DAG_NODE_FLOATS, type DagRoot } from './types.ts'
import {
  refreshStretchAt,
  refreshWorldStretch,
  worldChangedAt,
  worldsChanged,
  writePrimitiveWords,
} from './worlds.ts'
import { grown } from '../../page/cut/sparseInts.ts'
import type { createDagResidencyUpload } from './residencyUpload.ts'
import type { createDagPoolList } from './poolList.ts'
import type { createDagDispatch } from './dispatch.ts'
import { readFor } from './dispatchRead.ts'
import type { createDifferenceChain } from './differenceChain.ts'
import type { DagRuntimeState } from './runtimeState.ts'
import type { createDagResources } from './resources.ts'
import type { createWorldResidencyMirror } from './worldMirror.ts'
import { MAIN_VIEW } from './swap.ts'
import { appendDagRoots, type DagAppended } from './pack.ts'
import { keyBase } from './layout.ts'
import { writeParts } from './split.ts'

export type DagResources = NonNullable<Awaited<ReturnType<typeof createDagResources>>>

/** What a camera cut's methods share (`runtime.ts`): its tables, its state, the difference chain,
 *  the residency upload, the pool list, the world mirror, and the main view's dispatch. */
export type DagRun = ReturnType<typeof createDagDispatch> & {
  resources: DagResources
  state: DagRuntimeState
  chain: ReturnType<typeof createDifferenceChain>
  uploadResidency: ReturnType<typeof createDagResidencyUpload>
  poolList: ReturnType<typeof createDagPoolList>
  mirror: ReturnType<typeof createWorldResidencyMirror> | undefined
}

/** Cuts in hand and in flight name pages the kernel may no longer choose: they are void. */
function voidCuts(state: DagRuntimeState) {
  state.residencyRevision++
  state.last = null
}

/** `GpuSelection.updateWorlds`: the placements sent, compared with the last ones — every one, or
 *  those of `named` alone (`updateNamedWorlds`). */
export function updateRuntimeWorlds(
  run: DagRun,
  next: Float32Array,
  posesMoved: boolean,
  named?: Int32Array,
) {
  const { resources, state } = run,
    { packed, frames, frameData } = resources
  if (state.disposed || state.dead) return false
  if (next.byteLength !== packed.worlds.byteLength) throw new Error('GPU_SCENE_WORLD_COUNT_CHANGED')
  if (named) return updateNamedWorlds(run, next, posesMoved, named)
  const originChanged = posesMoved && frames.writeWorldOrigins()
  // `packed.worlds` is what this selection last received, and only this method writes it:
  // the worlds the next send is compared with, without a second copy of them beside it.
  if (!worldsChanged(packed.worlds, next)) {
    if (originChanged) state.worldRevision++
    return originChanged
  }
  // Stretch reads the linear part alone, which a moving origin leaves: read before the copy.
  const stretched = refreshWorldStretch(packed.worlds, next, packed, frameData)
  packed.worlds.set(next)
  frames.writeWorlds(next)
  if (stretched) frames.writeRows()
  // Cuts in hand and in flight keep their revision and still name what to stream (#358).
  if (posesMoved) state.worldRevision++
  return true
}

/** The placements that moved among those of `named`, and those whose stretch moved with them. */
let movedScratch = new Int32Array(8),
  stretchedScratch = new Int32Array(8)

/**
 * The placements of `named`, increasing — the ones a call moved —, compared with the worlds last
 * received and those that moved sent, each run to its range, with their exact translations and,
 * where the linear part moved, their stretch: a frame's CPU and upload follow what moved, never
 * the placements' count.
 */
function updateNamedWorlds(
  { resources, state }: DagRun,
  next: Float32Array,
  posesMoved: boolean,
  named: Int32Array,
) {
  const { packed, frames, frameData } = resources
  const originChanged = posesMoved && frames.writeWorldOrigins(named)
  let moved = 0,
    stretched = 0
  for (const w of named) {
    if (w >= packed.worldCount || !worldChangedAt(packed.worlds, next, w)) continue
    if (refreshStretchAt(packed.worlds, next, packed, frameData, w)) {
      if (stretched === stretchedScratch.length)
        stretchedScratch = grown(stretchedScratch, stretched + 1, stretched)
      stretchedScratch[stretched++] = w
    }
    packed.worlds.set(next.subarray(w * 16, w * 16 + 16), w * 16)
    if (moved === movedScratch.length) movedScratch = grown(movedScratch, moved + 1, moved)
    movedScratch[moved++] = w
  }
  if (moved) frames.writeNamedWorlds(packed.worlds, movedScratch, moved)
  if (stretched) frames.writeNamedRows(stretchedScratch, stretched)
  if (posesMoved && (moved || originChanged)) state.worldRevision++
  return moved > 0 || originChanged
}

/** `GpuSelection.appendRoots`: roots packed behind the others, their words sent. */
export function appendRoots(
  { resources, state, uploadResidency }: DagRun,
  roots: readonly DagRoot[],
) {
  if (state.disposed || state.dead || state.growing) return false
  const added = appendDagRoots(resources.packed, roots)
  if (!added) return false
  // Their nodes' open counts first: the node words go up once, with them.
  uploadResidency.append()
  writeAppended(resources, added)
  voidCuts(state)
  return true
}

/** `GpuSelection.updateResidency`: the pool's residency, through the world mirror when one packs. */
export function updateRuntimeResidency(
  { resources, state, uploadResidency, mirror }: DagRun,
  next: Uint32Array,
  changes?: ResidencyChanges,
  moved?: (page: number) => void,
) {
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
export function parkRoot({ resources, state }: DagRun, w: number, parked: boolean) {
  const { packed, frames } = resources
  const node = parked ? NONE : packed.rootBases[w]
  if (packed.rootNodes[w] === node) return
  packed.rootNodes[w] = node
  // The root travels behind the stretch in the frame buffer (`resources.ts`).
  frames.writeWord(w, 1, node)
  voidCuts(state)
}

/** Primitive `w`'s mark, as `parkRoot`. */
export function writeMark({ resources, state }: DagRun, w: number, mark: number) {
  const { packed, frames } = resources
  if (packed.mark[w] === mark) return
  packed.mark[w] = mark
  // The mark travels behind the record shift (`primitiveFrameWords`).
  frames.writeWord(w, 3, mark)
  voidCuts(state)
}

/** `GpuSelection.flush`: the reads in flight drained, a list grown and the cut made again on it,
 *  the cut made again under the poses in place. */
export async function flushRuntime({ resources, state }: DagRun, selection: GpuSelection) {
  await state.pending
  // A cut past its list grows it (`listCap.ts`): the drain grows it, then cuts again on it,
  // rather than hand back the cut before.
  const { cuts } = resources.swap
  for (const asked = cuts[MAIN_VIEW - 1]?.uniforms; asked && state.grow && !state.dead;) {
    selection.dispatch(asked)
    await state.pending
    selection.dispatch(asked)
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
    selection.dispatch(submitted.uniforms)
    await state.pending
  }
  const last = state.dead ? null : state.last
  return last?.worldRevision === state.worldRevision ? last.result : null
}

/** What `appendDagRoots` wrote, sent: the appended nodes, their pages' placement words and content
 *  keys, their primitives' frame rows, every world and origin, and the placement tree's nodes and
 *  member words they joined. Nothing else of the tables moved. */
function writeAppended(resources: DagResources, added: DagAppended) {
  const { device, packed, nodeParts, coldParts, frames, frameData } = resources,
    cones = packed.pageCones,
    nodeBytes = DAG_NODE_FLOATS * 4
  const send = (target: typeof nodeParts, source: Float32Array, from: number, bytes: number) =>
    bytes > 0 &&
    writeParts(device, target, from, source.buffer as ArrayBuffer, source.byteOffset + from, bytes)
  const [n0, n1] = added.nodes,
    [p0, p1] = added.pages,
    [w0, w1] = added.worlds
  send(nodeParts, packed.nodes, n0 * nodeBytes, (n1 - n0) * nodeBytes)
  send(coldParts, cones, p0 * 4, (p1 - p0) * 4)
  send(coldParts, cones, (keyBase(packed.pageCount) + p0) * 4, (p1 - p0) * 4)
  const tree = packed.placementTree,
    [m0, m1] = added.tree.members
  for (const n of added.tree.nodes) send(nodeParts, packed.nodes, n * nodeBytes, nodeBytes)
  if (tree) send(coldParts, cones, (tree.members + m0) * 4, (m1 - m0) * 4)
  for (let w = w0; w < w1; w++) writePrimitiveWords(frameData, packed, w)
  frames.writeRows(w0, w1)
  frames.writeWorlds(packed.worlds)
  frames.writeWorldOrigins()
}
