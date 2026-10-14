import { bitWords } from '../../../packages/math/src/scalar/integers.ts'
import type { PackedDag } from '../../../packages/sdk-browser/src/gpu/dag/types.ts'
import { compactDrawnPages, drawMask, writtenMask } from './globals.ts'
import {
  LIST_DROPPED,
  QUEUE_DROPPED,
  WORK_DROPPED,
} from '../../../packages/sdk-browser/src/gpu/dag/shader/viewsWgsl.ts'
import { viewWord } from '../../../packages/sdk-browser/src/gpu/dag/viewLayout.ts'
import { TRANSPARENT_STAGES } from './fakeComputeBlend.ts'
import { ROW_STAGES } from './fakeComputeRows.ts'
import { boundResource, words, type BoundBuffer } from './fakeBuffers.ts'
import { childBase } from '../../../packages/sdk-browser/src/gpu/dag/layout.ts'
import { fakeEvictions, sortStagedRequests } from './fakeEvict.ts'
import { POOL_SORT_REPLAYS } from './fakePoolSorts.ts'
import {
  DAG_SLOT,
  boundListCap,
  frameWord,
  packedFromBindings,
  readDagUniforms,
} from './fakeDag.ts'
import { boundData, viewTexture, worldsAtEye } from './fakeWorldPose.ts'
import { evaluateDagSelectionKernel } from '../../../packages/sdk-browser/src/gpu/dag/oracle/oracle.fixture.ts'
import {
  residentFlags,
  writeTriangleTotals,
} from '../../../packages/sdk-browser/src/gpu/dag/layout.fixture.ts'
import { simulateScatterGroups } from './fakeDrawCompact.ts'
import { stagedRequestsWord } from '../../../packages/sdk-browser/src/gpu/dag/readoutWords.ts'
import {
  stagedPage,
  stagedPriority,
} from '../../../packages/sdk-browser/src/gpu/dag/request.fixture.ts'
import { LIST_KERNELS, mirrorListStage } from './fakeLists.ts'
import { setBit } from '../../../packages/math/src/scalar/bits.ts'
import { ROOT_WORD } from '../../../packages/sdk-browser/src/gpu/dag/frameTable.ts'

/** The camera cut's kernels the double replays, on the selection's bind group or one of its
 *  entries (a kept list's: `rankGroups`). */
const DAG_STAGES = new Set([
  'dagMask',
  'dagDrawScatter',
  'dagCommitMask',
  'dagSortRequests',
  'poolScatter',
  ...LIST_KERNELS,
])

export type ComputeBind = {
  /** A buffer's binding, or a view's — the worlds' table (`viewTexture`). */
  entries: BoundBuffer[]
}

export function simulateComputeDispatch(
  computePipeline: { entryPoint: string; module?: { code?: string } } | undefined,
  computeBind: ComputeBind | undefined,
  packed?: PackedDag,
  offsets?: readonly number[],
  groups?: number,
  rows?: number,
) {
  const transparent = TRANSPARENT_STAGES[computePipeline?.entryPoint ?? '']
  if (transparent && computeBind) return transparent(computeBind, offsets, groups, rows)
  const rowStage = ROW_STAGES[computePipeline?.entryPoint ?? '']
  if (rowStage && computeBind?.entries) return rowStage(computeBind)
  if (computePipeline?.entryPoint === 'scatterGroups' && computeBind)
    return simulateScatterGroups(computeBind.entries)
  const stage = computePipeline?.entryPoint
  // A group a test wrote by hand, without entries, binds nothing the double could run on.
  if (!computeBind?.entries || !DAG_STAGES.has(stage ?? '')) return
  // A pool's queue on its sort's own group, by the program its pipeline runs (`fakePoolSorts.ts`).
  const poolSort = POOL_SORT_REPLAYS.get(computePipeline?.module?.code ?? '')
  if (stage === 'poolScatter' && poolSort) return poolSort(computeBind.entries, offsets)
  // The selection binds one table per `DAG_SLOT` name: one missing is a validation error. The
  // pool sort's last dispatch is the geometry queue's only on the selection's group.
  const slots = Object.keys(DAG_SLOT).length
  if (stage === 'poolScatter' && computeBind.entries.length !== slots)
    throw new Error('a pool sort the double does not replay')
  if (computeBind.entries.length !== slots)
    throw new Error(`dag selection bind group requires ${slots} entries`)
  // A record table reads as its texture's words, laid as its buffer was (`gpu/dag/cutTables.ts`).
  const byBinding = new Map(computeBind.entries.map((e) => [e.binding, boundData(e.resource)]))
  const boundWorlds = boundResource(computeBind.entries, DAG_SLOT.worlds),
    boundFrames = boundResource(computeBind.entries, DAG_SLOT.frames)
  // A test that hands no DAG reads the one the session uploaded (`fakeDag.ts`).
  const dag = packed ?? packedFromBindings(byBinding, boundWorlds, boundFrames),
    listCap = boundListCap(byBinding)
  if (stage === 'dagSortRequests') return sortStagedRequests(byBinding, listCap)
  if (mirrorListStage(stage!, byBinding, dag, listCap)) return // the lists' and the journals' mirror
  // The geometry queue whole on its last dispatch: `dagRaiseParents`, `poolCount` and `poolPlace`
  // leave nothing the mirror does not redo (`fakeEvict.ts`).
  if (stage === 'poolScatter') return fakeEvictions(byBinding, dag).list()
  // Compaction rereads the draw flags `dagMask` left, as `dagDrawPrefix` then `dagDrawScatter` do.
  if (stage === 'dagDrawScatter')
    return compactDrawnPages(
      byBinding.get(DAG_SLOT.work)!.data,
      byBinding.get(DAG_SLOT.out)!.data,
      dag.pageCount,
    )
  if (stage === 'dagCommitMask') return commitMask(byBinding, dag.pageCount)
  if (stage !== 'dagMask') return
  const { uniforms } = readDagUniforms(byBinding.get(DAG_SLOT.views)!.data)
  // The rule's residency lives in bits behind the cold records: the double rereads it through the
  // shared decoder, in the buffer the host writes, where the shader reads it.
  const cold = words(byBinding.get(DAG_SLOT.cold)!.data)
  const resident = {
    ready: residentFlags(cold, dag.pageCount),
    childReady: residentFlags(cold, dag.pageCount, childBase(dag.pageCount)),
  }
  // World matrices are read IN THE BOUND TABLE, where the shader reads them, each translation at
  // the eye of the same uniform block as the kernel reads it (`fakeWorldPose.ts`): the view and
  // planes are of that frame. A copy made at packing would put absolute worlds under a view with no
  // translation — two frames in one formula, and not a single page kept.
  const worlds = worldsAtEye(
    viewTexture(boundWorlds),
    byBinding.get(DAG_SLOT.views)!.data,
    dag.worlds.length,
  )
  // So is each primitive's root, its frame row's root word: a parked one is NONE (`parkWorld`),
  // and the cut skips it as the shader does.
  const rootNodes = dag.rootNodes.map((_, w) => frameWord(boundFrames, w, ROOT_WORD))
  const result = evaluateDagSelectionKernel({ ...dag, worlds, rootNodes }, uniforms, resident)
  fakeEvictions(byBinding, dag).stamp(
    [...result.pageIds, ...(result.drawablePageIds ?? [])],
    result.aheadPageIds,
  )
  // `dagMask` sets a draw bit for every drawn page: `dagDrawScatter` compacts them.
  const mask = writtenMask(byBinding.get(DAG_SLOT.work)!.data, dag.pageCount)
  mask.fill(0, 0, bitWords(dag.pageCount))
  for (const id of result.drawablePageIds ?? []) setBit(mask, id)
  const ints = words(byBinding.get(DAG_SLOT.out)!.data)
  ints[1] = result.frustumRejected
  ints[2] = result.lodLevel
  writeTriangleTotals(ints, result)
  // The camera's requests wait, in the order `dagWanted` emits them, where `dagSortRequests` reads:
  // two words each, the page then its priority.
  const list = result.requestWords,
    at = stagedRequestsWord(listCap)
  ints[0] = list.length
  // Past the cap a request is dropped and the sample says it is truncated (`emitOne`).
  ints[3] = list.length > listCap ? 1 : 0
  // Past a queue's entries or a list's, the kernel drops work: the cut is not drawn.
  const views = words(byBinding.get(DAG_SLOT.views)!.data),
    { levels, candidates, live } = result.work
  const entries = views[viewWord('queueCap')] / 2,
    cap = views[viewWord('candCap')]
  if (Math.max(...levels) > entries) ints[3] |= QUEUE_DROPPED
  if (candidates > cap || live > cap) ints[3] |= LIST_DROPPED
  list.slice(0, listCap).forEach((staged, s) => {
    ints[at + 2 * s] = stagedPage(staged)
    ints[at + 2 * s + 1] = stagedPriority(staged)
  })
}

/** `dagCommitMask`: the mask the cut wrote made the frame's, unless it dropped work. */
function commitMask(byBinding: Map<number, { data: Uint8Array }>, pageCount: number) {
  if (words(byBinding.get(DAG_SLOT.out)!.data)[3] & WORK_DROPPED) return
  const work = byBinding.get(DAG_SLOT.work)!.data
  const written = writtenMask(work, pageCount).subarray(0, bitWords(pageCount))
  drawMask(work, pageCount).set(written)
}
