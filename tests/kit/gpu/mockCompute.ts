import type { PackedDag } from '../../../packages/sdk-browser/src/gpu/dag/selection.ts'
import { DAG_BINDING } from '../../../packages/sdk-browser/src/gpu/dag/shader/bindings.ts'
import { primitiveWordAt } from '../../../packages/sdk-browser/src/gpu/dag/worlds.ts'
import { DRAW_ITEM_U32 } from '../../../packages/sdk-browser/src/gpu/draw/draw.ts'
import { compactDrawnPages } from './globals.ts'
import { TRANSPARENT_STAGES } from './mockComputeBlend.ts'
import { words } from './mockBuffers.ts'
import { childBase } from '../../../packages/sdk-browser/src/gpu/dag/layout.ts'
import { testBit } from '../../../packages/math/src/scalar/bits.fixture.ts'
import { mockEvictions, sortStagedRequests } from './mockEvict.ts'
import { boundListCap, packedFromBindings, readDagUniforms } from './mockDag.ts'
import { worldsAtEye } from './mockWorldPose.ts'
import { evaluateDagSelectionKernel } from '../../../packages/sdk-browser/src/gpu/dag/oracle/oracle.fixture.ts'
import {
  residentFlags,
  writeTriangleTotals,
} from '../../../packages/sdk-browser/src/gpu/dag/layout.fixture.ts'
import {
  evaluateDrawCompact,
  indirectForDraw,
  type DrawItem,
} from '../../../packages/sdk-browser/src/gpu/draw/cpu.fixture.ts'
import { stagedRequestsWord } from '../../../packages/sdk-browser/src/gpu/dag/readoutWords.ts'
import {
  stagedPage,
  stagedPriority,
} from '../../../packages/sdk-browser/src/gpu/dag/request.fixture.ts'
import { LIST_KERNELS, mirrorListStage } from './mockLists.ts'

/** The camera cut's kernels the double replays, on the selection's bind group or one of its
 *  entries (a kept list's: `rankGroups`). */
const DAG_STAGES = new Set([
  'dagMask',
  'dagDrawScatter',
  'dagSortRequests',
  'dagListEvictions',
  ...LIST_KERNELS,
])

export type ComputeBind = {
  entries: Array<{ binding: number; resource: { buffer: { data: Uint8Array } } }>
}

export function simulateComputeDispatch(
  computePipeline: { entryPoint: string } | undefined,
  computeBind: ComputeBind | undefined,
  computes: string[],
  packed?: PackedDag,
  offsets?: readonly number[],
) {
  if (computePipeline?.entryPoint) computes.push(computePipeline.entryPoint)
  const transparent = TRANSPARENT_STAGES[computePipeline?.entryPoint ?? '']
  if (transparent && computeBind) return transparent(computeBind, offsets)
  if (computePipeline?.entryPoint === 'scatterGroups' && computeBind) {
    const byBinding = new Map(
      computeBind.entries.map((entry) => [entry.binding, entry.resource.buffer]),
    )
    const uni = words(byBinding.get(1)!.data)
    const count = uni[0],
      maxVertexCount = uni[1],
      slotCap = uni[2]
    const itemInts = words(byBinding.get(0)!.data)
    const n = Math.min(count, slotCap)
    const restInts = words(byBinding.get(7)!.data)
    const restAt = (i: number) => testBit(restInts, i) as 0 | 1
    const items: DrawItem[] = []
    for (let i = 0; i < n; i++)
      items.push({
        pageIndex: itemInts[i * DRAW_ITEM_U32],
        bin: itemInts[i * DRAW_ITEM_U32 + 1],
        rest: restAt(i),
      })
    const source =
      count > slotCap
        ? items.concat(
            Array.from({ length: count - n }, () => ({
              pageIndex: 0,
              bin: 0 as const,
              rest: 0 as const,
            })),
          )
        : items
    const maskBytes = byBinding.get(6)?.data
    const mask = maskBytes ? words(maskBytes) : undefined
    const filtered =
      uni[4] && mask
        ? source.filter((_, i) => mask[uni[5] + itemInts[i * DRAW_ITEM_U32 + 2]] !== 0)
        : source
    const result = evaluateDrawCompact(count > slotCap ? source : filtered, maxVertexCount, slotCap)
    words(byBinding.get(5)!.data).set(result.counts.map((_, slot) => result.indirect[slot * 4 + 3]))
    words(byBinding.get(2)!.data).set(result.instances)
    words(byBinding.get(3)!.data).set(indirectForDraw(result))
    return
  }
  const stage = computePipeline?.entryPoint
  if (!computeBind || !DAG_STAGES.has(stage ?? '')) return
  // The selection binds one buffer per `DAG_BINDING` slot: one missing is a validation error.
  const slots = Object.keys(DAG_BINDING).length
  if (computeBind.entries.length !== slots)
    throw new Error(`dag selection bind group requires ${slots} entries`)
  const byBinding = new Map(
    computeBind.entries.map((entry) => [entry.binding, entry.resource.buffer]),
  )
  // A test that hands no DAG reads the one the session uploaded (`mockDag.ts`).
  const dag = packed ?? packedFromBindings(byBinding),
    listCap = boundListCap(byBinding)
  if (stage === 'dagSortRequests') return sortStagedRequests(byBinding, listCap)
  if (mirrorListStage(stage!, byBinding, dag, listCap)) return // the lists' and the journals' mirror
  if (stage === 'dagListEvictions') return mockEvictions(byBinding, dag).list()
  // Compaction rereads the draw flags `dagMask` left, as `dagDrawPrefix` then `dagDrawScatter` do.
  if (stage === 'dagDrawScatter')
    return compactDrawnPages(
      byBinding.get(DAG_BINDING.flags)!.data,
      byBinding.get(DAG_BINDING.out)!.data,
      dag.nodeCount,
      dag.pageCount,
    )
  if (stage !== 'dagMask') return
  const { uniforms } = readDagUniforms(byBinding.get(DAG_BINDING.views)!.data)
  // The rule's residency lives in bits behind the cold records: the double rereads it through the
  // shared decoder, in the buffer the host writes, where the shader reads it.
  const cold = words(byBinding.get(DAG_BINDING.cold)!.data)
  const resident = {
    ready: residentFlags(cold, dag.pageCount),
    childReady: residentFlags(cold, dag.pageCount, childBase(dag.pageCount)),
  }
  // World matrices are read IN THE BOUND BUFFER, where the shader reads them, each translation at
  // the eye of the same uniform block as the kernel reads it (`mockWorldPose.ts`): the view and
  // planes are of that frame. A copy made at packing would put absolute worlds under a view with no
  // translation — two frames in one formula, and not a single page kept.
  const worlds = worldsAtEye(
    byBinding.get(DAG_BINDING.worlds)!.data,
    byBinding.get(DAG_BINDING.views)!.data,
    dag.worlds.length,
  )
  // So is each primitive's root, behind its stretch in the frame buffer: a parked one is NONE
  // (`parkWorld`), and the cut skips it as the shader does.
  const frames = words(byBinding.get(DAG_BINDING.frames)!.data)
  const rootNodes = dag.rootNodes.map((_, w) => frames[primitiveWordAt(w) + 1])
  const result = evaluateDagSelectionKernel({ ...dag, worlds, rootNodes }, uniforms, resident)
  mockEvictions(byBinding, dag).stamp([...result.pageIds, ...(result.drawablePageIds ?? [])])
  // `dagMask` posts a draw flag for every drawn page: `dagDrawScatter` compacts them.
  const flags = words(byBinding.get(DAG_BINDING.flags)!.data)
  flags.fill(0, dag.nodeCount, dag.nodeCount + dag.pageCount)
  for (const id of result.drawablePageIds ?? []) flags[dag.nodeCount + id] = 1
  const ints = words(byBinding.get(DAG_BINDING.out)!.data)
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
  list.slice(0, listCap).forEach((staged, s) => {
    ints[at + 2 * s] = stagedPage(staged)
    ints[at + 2 * s + 1] = stagedPriority(staged)
  })
}
