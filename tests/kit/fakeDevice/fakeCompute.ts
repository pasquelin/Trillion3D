import { bitWords } from '../../../packages/math/src/scalar/integers.ts'
import type { PackedDag } from '../../../packages/sdk-browser/src/geometry/dag/types.ts'
import { compactDrawnPages, drawMask, writtenMask } from './globals.ts'
import { TRANSPARENT_STAGES } from './fakeComputeBlend.ts'
import { ROW_STAGES } from './fakeComputeRows.ts'
import { boundResource, words, type BoundBuffer } from './fakeBuffers.ts'
import { childBase } from '../../../packages/sdk-browser/src/geometry/dag/layout.ts'
import { poolSortReplayOf } from './fakePoolSorts.ts'
import {
  DAG_SLOT,
  boundListCap,
  frameWord,
  packedFromBindings,
  readDagUniforms,
} from './fakeDag.ts'
import { boundData, viewTexture, worldsAtEye } from './fakeWorldPose.ts'
import { evaluateDagSelectionKernel } from '../../../packages/sdk-browser/src/geometry/dag/oracle/oracle.fixture.ts'
import {
  residentFlags,
  writeTriangleTotals,
} from '../../../packages/sdk-browser/src/geometry/dag/layout.fixture.ts'
import { simulateScatterGroups } from './fakeDrawCompact.ts'
import {
  countWord,
  listWords,
  PEAK_CANDIDATES,
  PEAK_NODES,
  PEAK_VISIBLE,
  priorityWord,
  SELECTION_HEADER_WORDS,
} from '../../../packages/sdk-browser/src/geometry/dag/readoutWords.ts'
import { LIST_KERNELS, mirrorListStage } from './fakeLists.ts'
import { setBit } from '../../../packages/math/src/scalar/bits.ts'
import { ROOT_WORD } from '../../../packages/sdk-browser/src/geometry/dag/frameTable.ts'
import { drawModuleLabel } from '../../../packages/sdk-browser/src/visibility/draw/shader.ts'
import { untag } from './fakeWebgpuDevice.ts'

/** The camera cut's kernels the double replays, on the selection's bind group or one of its
 *  entries (a kept list's: `rankGroups`), and the pool sorts' last dispatch, on their own group. */
const DAG_STAGES = new Set([
  'dagMask',
  'dagDrawScatter',
  'dagCommitMask',
  'poolScatter',
  ...LIST_KERNELS,
])

export type ComputeBind = {
  /** A buffer's binding, or a view's — the worlds' table (`viewTexture`). */
  entries: BoundBuffer[]
}

export function simulateComputeDispatch(
  computePipeline: { entryPoint: string; module?: { code?: string; label?: string } } | undefined,
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
  // The post half's kernels are the ones that place their rows in the post slots: its module says
  // so by its label (`drawModuleLabel`), as the engine wrote it, without its session's tag.
  if (computePipeline?.entryPoint === 'scatterGroups' && computeBind)
    return simulateScatterGroups(
      computeBind.entries,
      untag(computePipeline.module?.label) === drawModuleLabel(true),
    )
  const stage = computePipeline?.entryPoint
  // A group a test wrote by hand, without entries, binds nothing the double could run on.
  if (!computeBind?.entries || !DAG_STAGES.has(stage ?? '')) return
  // A pool's queue on its sort's own group, by the program its pipeline runs (`fakePoolSorts.ts`).
  if (stage === 'poolScatter') {
    const poolSort = poolSortReplayOf(computePipeline?.module?.code ?? '')
    if (!poolSort) throw new Error('a pool sort the double does not replay')
    return poolSort(computeBind.entries, offsets)
  }
  // The selection binds one table per `DAG_SLOT` name: one missing is a validation error.
  const slots = Object.keys(DAG_SLOT).length
  if (computeBind.entries.length !== slots)
    throw new Error(`dag selection bind group requires ${slots} entries`)
  // A record table reads as its texture's words, laid as its buffer was (`dag/cut/cutTables.ts`).
  const byBinding = new Map(computeBind.entries.map((e) => [e.binding, boundData(e.resource)]))
  const boundWorlds = boundResource(computeBind.entries, DAG_SLOT.worlds),
    boundFrames = boundResource(computeBind.entries, DAG_SLOT.frames)
  // A test that hands no DAG reads the one the session uploaded (`fakeDag.ts`).
  const dag = packed ?? packedFromBindings(byBinding, boundWorlds, boundFrames),
    listCap = boundListCap(byBinding)
  if (mirrorListStage(stage!, byBinding, dag, listCap)) return // the lists' and the journals' mirror
  // Compaction rereads the draw flags `dagMask` left, as `dagDrawPrefix` then `dagDrawScatter` do.
  if (stage === 'dagDrawScatter')
    return compactDrawnPages(
      byBinding.get(DAG_SLOT.work)!.data,
      byBinding.get(DAG_SLOT.out)!.data,
      dag.pageCount,
      listCap,
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
  // `dagMask` sets a draw bit for every drawn page: `dagDrawScatter` compacts them.
  const mask = writtenMask(byBinding.get(DAG_SLOT.work)!.data, dag.pageCount)
  mask.fill(0, 0, bitWords(dag.pageCount))
  for (const id of result.drawablePageIds ?? []) setBit(mask, id)
  const ints = words(byBinding.get(DAG_SLOT.out)!.data)
  ints[1] = result.frustumRejected
  ints[2] = result.lodLevel
  writeTriangleTotals(ints, result)
  // The camera's requests, in the order the oracle asks them (`requestPage`): each leaf's first
  // page at its rank of the first list, its page count and its priority at the same rank of their
  // lists (`countWord`, `priorityWord`).
  const { pages, counts, priorities } = result.requests,
    at = priorityWord(listCap),
    countAt = countWord(listCap)
  ints[0] = pages.length
  // Past the cap a request is dropped and the sample says it is truncated (`requestPage`).
  ints[3] = pages.length > listCap ? 1 : 0
  // What the cut asked of its lists, in the drawn list's header (`dagCommitMask`): the double's
  // cut is whole, every node of its levels opened in one pass.
  const peaks = listWords(listCap),
    { levels, candidates, live } = result.work
  ints[peaks + PEAK_NODES] = levels.reduce((sum, level) => sum + level, 0)
  ints[peaks + PEAK_CANDIDATES] = candidates
  ints[peaks + PEAK_VISIBLE] = live
  for (let s = 0; s < Math.min(listCap, pages.length); s++) {
    ints[SELECTION_HEADER_WORDS + s] = pages[s]
    ints[countAt + s] = counts[s]
    ints[at + s] = priorities[s]
  }
}

/** `dagCommitMask`: the mask the cut wrote made the frame's. */
function commitMask(byBinding: Map<number, { data: Uint8Array }>, pageCount: number) {
  const work = byBinding.get(DAG_SLOT.work)!.data
  const written = writtenMask(work, pageCount).subarray(0, bitWords(pageCount))
  drawMask(work, pageCount).set(written)
}
