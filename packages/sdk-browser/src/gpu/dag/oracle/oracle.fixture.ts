import {
  dagRecords,
  bandError,
  worldOf,
  boxInto,
  trianglesOf,
  flagsOf,
} from '../records.fixture.ts'
import { dagViewFrames, thresholdOf } from './math.fixture.ts'
import { dagOracleDescent, AHEAD_LEAF } from './descent.fixture.ts'
import { oracleWorldCovers } from './worldGate.fixture.ts'
import { createDagOraclePredicates } from './predicates.fixture.ts'
import { aheadDue } from '../aheadDue.fixture.ts'
import {
  quantizeAdmission,
  quantizeAheadPriority,
  quantizeRequestPriority,
  sortStaged,
  stagedPage,
  stagedPriority,
  stagedRequest,
  firstAheadRequest,
} from '../request.fixture.ts'
import { CLUSTER_LEVEL_SHIFT, CLUSTER_ROOT_CHILD, CLUSTER_TRANSPARENT } from '../clusterFlags.ts'
import type { PackedDag, DagViewUniforms } from '../types.ts'
import type { CutRuleAt } from './predicates.fixture.ts'
import { SELECTION_NONE, type SelectionResult } from '../../core/selection.ts'

/**
 * Node oracle for the kernel, in the same shape the shader uses. Not called by the renderer.
 *
 * `rule`: the cut rule applied, `drawsCluster` by default; the rule's tests pass the kernel's
 * `dagMask` call site run in Node (`../../../page/cut/cutRule.test.ts`), so the kernel's own text
 * decides, on the residency bits its host uploaded.
 */
export function evaluateDagSelectionKernel(
  packed: PackedDag,
  uniforms: DagViewUniforms,
  resident?: DagCutResidency,
  rule?: CutRuleAt,
): DagOracleResult {
  if (
    resident &&
    (resident.ready.length !== packed.pageCount || resident.childReady.length !== packed.pageCount)
  )
    throw new Error('GPU_SELECTION_RESIDENCY_COUNT_CHANGED')
  // The single decoder of the compact layout: the same one the buffer double rereads, so
  // no field rank is written anywhere but once, in `../layout.ts`.
  const records = dagRecords(packed)
  // The pages its roots hold: the room past them belongs to no placement (`../pack.ts`).
  const livePages = packed.live?.pages ?? packed.pageCount
  // The per-primitive prologue and per-node verdict are those of `math.fixture.ts`,
  // written once: frontier counting rereads them, and neither it nor the oracle can drift alone.
  const frames = dagViewFrames(packed, uniforms)
  // The view ahead of a moving camera (`../shader/aheadWgsl.ts`).
  const ahead = uniforms.ahead ?? null
  const aheadFrames = ahead
    ? dagViewFrames(packed, { ...uniforms, planes: ahead.planes, view: ahead.view })
    : undefined
  // Descent, mirror of `../shader/levelWgsl.ts`, set aside: it returns each node's verdict.
  const nodeFlags = dagOracleDescent(
    packed,
    frames,
    aheadFrames,
    oracleWorldCovers(packed, frames, resident?.ready),
  )
  const predicates = (f: typeof frames, flags: Uint8Array) =>
    createDagOraclePredicates({
      packed,
      records,
      nodeFlags: flags,
      ...f,
      rule,
    })
  const camera = predicates(frames, nodeFlags)
  const { coneRejects, visible, draws } = camera
  // The view ahead reads every kept leaf, the camera's and its own.
  const aheadView =
    aheadFrames &&
    predicates(
      aheadFrames,
      nodeFlags.map((f) => (f === AHEAD_LEAF ? 0 : f)),
    )
  /** The error the page's replacement removes, or its own when nothing replaces it (`dagWanted`). */
  const replaced = (view: ReturnType<typeof predicates>, i: number) =>
    view.bandPixels(i, bandError(records, i, 1) < 0 ? 0 : 1)
  /** The staged requests in the order `dagWanted` stages them, both tiers mixed. */
  const requestWords: number[] = []
  /** `cameraPriority`: by error, or by admission when the pool cannot hold the cut. */
  const cameraPriority = (i: number, pixels: number) => {
    const flags = flagsOf(records, i)
    return uniforms.admitByLevel
      ? quantizeAdmission(flags >>> CLUSTER_LEVEL_SHIFT, !!(flags & CLUSTER_ROOT_CHILD), pixels)
      : quantizeRequestPriority(pixels)
  }
  /** `wantAhead`: a page the camera does not request, requested ahead when that view selects it,
   *  ranked by when the camera needs it (`../aheadDue.ts`), then by its error. */
  const box = { min: [0, 0, 0], max: [0, 0, 0] }
  const wantAhead = (i: number) => {
    if (!aheadView || !aheadFrames || !aheadView.visible(i)) return
    const w = worldOf(records, i)
    if (!aheadView.draws(i, thresholdOf(aheadFrames, w), true, true)) return
    boxInto(records, i, box.min, box.max)
    const due = aheadDue(frames.planes[w], aheadFrames.planes[w], box.min, box.max)
    requestWords.push(stagedRequest(i, quantizeAheadPriority(replaced(aheadView, i), due)))
  }
  // Totals the GPU holds, replayed where `dagMask` notes them (`../shader/totalsWgsl.ts`).
  const totals = { drawn: 0, transparent: 0 }
  const note = (i: number) => {
    const tri = trianglesOf(records, i)
    totals.drawn += tri
    if (flagsOf(records, i) & CLUSTER_TRANSPARENT) totals.transparent += tri
  }
  let frustumRejected = 0,
    lodLevel = 0
  for (let i = 0; i < livePages; i++) {
    const w = worldOf(records, i)
    // Room past the roots, as a table read back from the GPU holds it: no placement, no cut.
    if (w === SELECTION_NONE) continue
    if (!visible(i)) {
      frustumRejected++
      wantAhead(i)
      continue
    }
    if (!draws(i, thresholdOf(frames, w), true, true) || coneRejects(i, w)) {
      wantAhead(i)
      continue
    }
    const level = flagsOf(records, i) >>> CLUSTER_LEVEL_SHIFT
    if (level > lodLevel) lodLevel = level
    requestWords.push(stagedRequest(i, cameraPriority(i, replaced(camera, i))))
  }
  // `dagMask`: the cut rule on every live cluster — visible, not rejected by its cone. Without
  // residency every cluster and every finer group is held, and the drawn cut is the kept one.
  const drawablePageIds: number[] = []
  for (let i = 0; i < livePages; i++) {
    const w = worldOf(records, i)
    if (w === SELECTION_NONE || !visible(i) || coneRejects(i, w)) continue
    const ready = !resident || !!resident.ready[i],
      childReady = !resident || !!resident.childReady[i]
    if (!draws(i, thresholdOf(frames, w), ready, childReady)) continue
    note(i)
    drawablePageIds.push(i)
  }
  // The readout is returned as `dagSortRequests` writes it: highest `requestRank` first, every
  // visible request before the view ahead's (`../request.ts`).
  const sorted = sortStaged(requestWords),
    visibleWords = sorted.slice(0, firstAheadRequest(sorted))
  return {
    pageIds: visibleWords.map(stagedPage),
    aheadPageIds: sorted.slice(visibleWords.length).map(stagedPage),
    requestPriorities: visibleWords.map(stagedPriority),
    requestWords,
    frustumRejected,
    lodLevel,
    drawablePageIds,
    selectedTriangles: totals.drawn,
    transparentTriangles: totals.transparent,
    drawnTriangles: totals.drawn,
  } as DagOracleResult
}

/** The cut rule's residency, one entry per page: the bit sets its host uploads, read back
 *  (`../readiness.fixture.ts`). */
export type DagCutResidency = { ready: ArrayLike<number>; childReady: ArrayLike<number> }

/** What the oracle returns: the cut, and the staged requests (`stagedRequest`) in the order
 *  `dagWanted` stages them, before the GPU sorts them. */
export type DagOracleResult = SelectionResult & {
  requestWords: number[]
  /** Priority of each request, at the same rank as `pageIds` (`../request.ts`): the oracle's own,
   *  for the proofs that compare the two rankings; the GPU returns only the order. */
  requestPriorities: number[]
}
