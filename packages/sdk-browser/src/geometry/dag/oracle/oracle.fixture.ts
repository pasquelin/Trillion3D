import { dagRecords, worldOf, trianglesOf, flagsOf, ownerOf } from '../records.fixture.ts'
import { dagViewFrames } from './math.fixture.ts'
import { dagOracleDescent } from './descent.fixture.ts'
import { oracleWorldCovers, oracleWorldHides } from './worldGate.fixture.ts'
import { createDagOraclePredicates } from './predicates.fixture.ts'
import { dagLeafPriority } from './nodeVerdict.fixture.ts'
import { CLUSTER_LEVEL_SHIFT, CLUSTER_TRANSPARENT } from '../clusterFlags.ts'
import type { PackedDag } from '../types.ts'
import type { CutRuleAt } from './predicates.fixture.ts'
import { type SelectionResult, type SelectionUniforms } from '../../../gpu/core/selection.ts'
import { NO_INDEX } from '../../../../../math/src/constants.ts'

/**
 * Node oracle for the kernel, in the same shape the shader uses. Not called by the renderer.
 *
 * `rule`: the cut rule applied, `drawsCluster` by default; the rule's tests pass the kernel's
 * `dagWanted` call site run in Node (`../../cut/cutRule.test.ts`), so the kernel's own text
 * decides, on the residency bits its host uploaded.
 */
export function evaluateDagSelectionKernel(
  packed: PackedDag,
  uniforms: SelectionUniforms,
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
  // The pages its roots hold: the room past them belongs to no placement (`../pack/pack.ts`).
  const livePages = packed.live?.pages ?? packed.pageCount
  // The per-primitive prologue and per-node verdict are those of `math.fixture.ts`,
  // written once: frontier counting rereads them, and neither it nor the oracle can drift alone.
  const frames = dagViewFrames(packed, uniforms)
  // Descent, mirror of `../shader/levelWgsl.ts`, set aside: it returns each node's verdict.
  const nodeFlags = dagOracleDescent(packed, frames, oracleWorldCovers(packed))
  const { visible, draws } = createDagOraclePredicates({ records, nodeFlags, ...frames, rule })
  /** The camera's requests (`depositLeaf`, `../shader/levelWgsl.ts`): one a kept leaf, seen or not
   *  by the frustum and the cut rule — its first page, its page count, its priority — in page
   *  order, one of the orders the kernel's threads give; the host ranks them
   *  (`../request/request.ts`). `pageIds` are the pages they name, request after request. The
   *  candidates are the pages of the kept leaves with a resident page (`leafLoaded`). */
  const requests = { pages: [] as number[], counts: [] as number[], priorities: [] as number[] },
    pageIds: number[] = []
  let candidates = 0
  // Totals the GPU holds, replayed where `dagMask` notes them (`../shader/totalsWgsl.ts`).
  const totals = { drawn: 0, transparent: 0 }
  const note = (i: number) => {
    const tri = trianglesOf(records, i)
    totals.drawn += tri
    if (flagsOf(records, i) & CLUSTER_TRANSPARENT) totals.transparent += tri
  }
  let frustumRejected = 0,
    lodLevel = 0
  // A world cluster whose cell its HLOD does not draw is neither drawn nor asked for.
  const hides = oracleWorldHides(packed)
  for (let i = 0; i < livePages; i++) {
    const w = worldOf(records, i)
    // Room past the roots, as a table read back from the GPU holds it: no placement, no cut.
    if (w === NO_INDEX || hides(i)) continue
    const leaf = ownerOf(records, i)
    if (
      leaf !== NO_INDEX &&
      nodeFlags.at(w, leaf) === 0 &&
      (i === 0 || worldOf(records, i - 1) !== w || ownerOf(records, i - 1) !== leaf)
    ) {
      // The leaf's pages: the run of consecutive packed pages its placement and node own.
      let count = 1
      while (
        i + count < livePages &&
        worldOf(records, i + count) === w &&
        ownerOf(records, i + count) === leaf
      )
        count++
      requests.pages.push(i)
      requests.counts.push(count)
      requests.priorities.push(dagLeafPriority(frames, packed.nodes, leaf, w))
      let loaded = !resident
      for (let k = 0; k < count; k++) {
        pageIds.push(i + k)
        loaded ||= !!resident?.ready[i + k]
      }
      if (loaded) candidates += count
    }
    if (!visible(i)) {
      frustumRejected++
      continue
    }
    if (!draws(i, frames.pixelError, true, true)) continue
    const level = flagsOf(records, i) >>> CLUSTER_LEVEL_SHIFT
    if (level > lodLevel) lodLevel = level
  }
  // `dagWanted`: the cut rule on every visible cluster. Without residency every cluster and every
  // finer group is held, and the drawn cut is the kept one.
  const drawablePageIds: number[] = []
  for (let i = 0; i < livePages; i++) {
    const w = worldOf(records, i)
    if (w === NO_INDEX || hides(i) || !visible(i)) continue
    const ready = !resident || !!resident.ready[i],
      childReady = !resident || !!resident.childReady[i]
    if (!draws(i, frames.pixelError, ready, childReady)) continue
    note(i)
    drawablePageIds.push(i)
  }
  return {
    requests,
    pageIds,
    frustumRejected,
    lodLevel,
    drawablePageIds,
    // No pyramid: nothing is hidden, nothing waits for a post pass (`../shader/occlusionWgsl.ts`).
    occluded: 0,
    postHidden: 0,
    selectedTriangles: totals.drawn,
    transparentTriangles: totals.transparent,
    // What the kernel's queues and lists hold (`../shader/levelWgsl.ts`): past their caps, it drops
    // work and the cut is not drawn. The live list holds the clusters drawn (`../shader/liveWgsl.ts`).
    work: { ...nodeFlags.work, candidates, live: drawablePageIds.length },
  }
}

/** The cut rule's residency, one entry per page: the bit sets its host uploads, read back
 *  (`../readiness.fixture.ts`). */
export type DagCutResidency = { ready: ArrayLike<number>; childReady: ArrayLike<number> }

/** What the oracle returns: the cut, its requests and their priorities as the readout holds them. */
export type DagOracleResult = SelectionResult & {
  /** The entries each level's queue holds, the candidates and the live pages. */
  work: { levels: number[]; candidates: number; live: number }
}
