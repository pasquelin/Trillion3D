import {
  dagRecords,
  bandError,
  worldOf,
  boxInto,
  trianglesOf,
  flagsOf,
} from '../records.fixture.ts'
import { dagViewFrames } from './math.fixture.ts'
import { dagOracleDescent, AHEAD_LEAF } from './descent.fixture.ts'
import { createDagOraclePredicates } from './predicates.fixture.ts'
import { aheadDue } from '../aheadDue.fixture.ts'
import { packRequest, requestPage, requestPriority } from '../request.ts'
import {
  quantizeAheadPriority,
  quantizeRequestPriority,
  sortRequestWords,
  firstAheadRequest,
} from '../request.fixture.ts'
import { CLUSTER_LEVEL_SHIFT, CLUSTER_TRANSPARENT } from '../clusterFlags.ts'
import type { PackedDag, DagViewUniforms } from '../types.ts'
import type { CutRuleAt } from './predicates.fixture.ts'
import type { SelectionResult } from '../../core/selection.ts'

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
  // The per-primitive prologue and per-node verdict are those of `math.fixture.ts`,
  // written once: frontier counting rereads them, and neither it nor the oracle can drift alone.
  const frames = dagViewFrames(packed, uniforms)
  const { pixelError } = frames
  // The view ahead of a moving camera (`../shader/aheadWgsl.ts`).
  const ahead = uniforms.ahead ?? null
  const aheadFrames = ahead
    ? dagViewFrames(packed, { ...uniforms, planes: ahead.planes, view: ahead.view })
    : undefined
  // Descent, mirror of `../shader/levelWgsl.ts`, set aside: it returns each node's verdict.
  const nodeFlags = dagOracleDescent(packed, frames, aheadFrames)
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
  /** The request words in the order `dagWanted` stages them, both tiers mixed. */
  const requestWords: number[] = []
  /** `wantAhead`: a page the camera does not request, requested ahead when that view selects it,
   *  ranked by when the camera needs it (`../aheadDue.ts`), then by its error. */
  const box = { min: [0, 0, 0], max: [0, 0, 0] }
  const wantAhead = (i: number) => {
    if (!aheadView || !aheadFrames || !aheadView.visible(i)) return
    if (!aheadView.draws(i, pixelError, true, true)) return
    const w = worldOf(records, i)
    boxInto(records, i, box.min, box.max)
    const due = aheadDue(frames.planes[w], aheadFrames.planes[w], box.min, box.max)
    requestWords.push(packRequest(i, quantizeAheadPriority(replaced(aheadView, i), due)))
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
  for (let i = 0; i < packed.pageCount; i++) {
    const w = worldOf(records, i)
    if (!visible(i)) {
      frustumRejected++
      wantAhead(i)
      continue
    }
    if (!draws(i, pixelError, true, true) || coneRejects(i, w)) {
      wantAhead(i)
      continue
    }
    const level = flagsOf(records, i) >>> CLUSTER_LEVEL_SHIFT
    if (level > lodLevel) lodLevel = level
    requestWords.push(packRequest(i, quantizeRequestPriority(replaced(camera, i))))
  }
  // `dagMask`: the cut rule on every live cluster — visible, not rejected by its cone. Without
  // residency every cluster and every finer group is held, and the drawn cut is the kept one.
  const drawablePageIds: number[] = []
  for (let i = 0; i < packed.pageCount; i++) {
    const w = worldOf(records, i)
    if (!visible(i) || coneRejects(i, w)) continue
    const ready = !resident || !!resident.ready[i],
      childReady = !resident || !!resident.childReady[i]
    if (!draws(i, pixelError, ready, childReady)) continue
    note(i)
    drawablePageIds.push(i)
  }
  // The readout is returned as `dagSortRequests` writes it: highest `requestRank` first, every
  // visible request before the view ahead's (`../request.ts`).
  const sorted = [...sortRequestWords(requestWords)],
    visibleWords = sorted.slice(0, firstAheadRequest(sorted))
  return {
    pageIds: visibleWords.map(requestPage),
    aheadPageIds: sorted.slice(visibleWords.length).map(requestPage),
    requestPriorities: visibleWords.map(requestPriority),
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

/** What the oracle returns: the cut, and the request words in the order `dagWanted` stages them,
 *  before the GPU sorts them. */
export type DagOracleResult = SelectionResult & { requestWords: number[] }
