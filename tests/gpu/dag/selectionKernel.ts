// The DAG selection kernel run on the GPU: the device and its pipelines opened once, then for each
// case its buffers as the engine lays them out (`selectionCase.ts`), the stages `dagPrepare`, the
// level descent, `dagWanted`, `dagMask` and `dagSortRequests` in the engine's order
// (`gpu/dag/encode.ts`) for a cut that starts from fresh buffers, then the readout, the frame
// counters and the draw flags read back.
import assert from 'node:assert/strict'
import { DAG_SELECTION_SHADER } from '../../../packages/sdk-browser/src/gpu/dag/shader/shader.ts'
import { dagBindEntries } from '../../../packages/sdk-browser/src/gpu/dag/shader/bindings.ts'
import { SELECTION_WORKGROUP } from '../../../packages/sdk-browser/src/gpu/core/selection.ts'
import { stagedRequestsWord } from '../../../packages/sdk-browser/src/gpu/dag/readoutWords.ts'
import { LEVEL_QUEUES } from '../../../packages/sdk-browser/src/gpu/dag/shader/levelWgsl.ts'
import {
  OUT_COUNT,
  OUT_FLAGS,
  OUT_FRUSTUM_REJECTED,
  OUT_SELECTED_TRIANGLES,
  OUT_TRANSPARENT_TRIANGLES,
  SELECTION_HEADER_WORDS,
} from '../../../packages/sdk-browser/src/gpu/dag/layout.ts'
import { readBuffer } from '../kit/computeReadback.ts'
import { runOnDawn } from '../kit/onDawn.ts'
import { openGpuDevice } from '../kit/webgpuDevice.ts'
import { bindCase, type SelectionCase, type StageOutput } from './selectionCase.ts'

export type { SelectionCase } from './selectionCase.ts'

/** What one case's cut left on the GPU. */
interface SelectionReading {
  name: string
  /** Requested pages in the order the GPU sorted them, a whole word each. */
  requests: number[]
  /** Each request's priority, at its rank: read where `dagWanted` staged it, beside its page. */
  priorities: number[]
  /** The requested pages, in increasing order. */
  pages: number[]
  frustumRejected: number
  overflow: number
  selectedTriangles: number
  transparentTriangles: number
  /** Pages `dagMask` flagged drawn, in increasing order. */
  drawn: number[]
  /** The descent's candidates and the live clusters `dagWanted` kept: what the frame rereads. */
  candidates: number
  live: number
}

/**
 * Opens the device and builds the kernel's pipelines once — `shader`, the shipped one by default,
 * or a variant to compare it with — for every cut a proof runs on them. A device that is missing or
 * a text that does not compile fails the opening; a GPU error fails `close`.
 */
export async function openSelectionKernel(shader = DAG_SELECTION_SHADER) {
  const gpu = await openGpuDevice()
  assert.ok(gpu, 'WebGPU must be available')
  const { device } = gpu
  const { module, compilation } = await gpu.compile(shader)
  assert.deepEqual(compilation, [], 'the selection kernel compiles')
  const layout = device.createBindGroupLayout({ entries: dagBindEntries() })
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] })
  const stage = (entryPoint: string) =>
    device.createComputePipeline({ layout: pipelineLayout, compute: { module, entryPoint } })
  // Level 0 is the root level, as the engine encodes it (`gpu/dag/encode.ts`): the queue's slots,
  // a grouped placement's left to its kept group (`placementTreeWgsl.ts`).
  const prepare = stage('dagPrepare'),
    levels = Array.from({ length: LEVEL_QUEUES }, (_, q) =>
      stage(q ? `dagLevel${q}` : 'dagRootLevel'),
    ),
    deeper = stage('dagLevel0'),
    wanted = stage('dagWanted'),
    mask = stage('dagMask'),
    sort = stage('dagSortRequests')
  const groups = (threads: number) => Math.max(1, Math.ceil(threads / SELECTION_WORKGROUP))

  const bind = (selection: SelectionCase, write?: StageOutput) =>
    bindCase(device, layout, selection, write)

  type Run = [GPUComputePipeline, number]
  /** Encodes `passes` on `group` and submits them: each a compute pass of its runs, a pipeline
   *  and its workgroups each, every dispatch seeing what the one before wrote. */
  function dispatch(group: GPUBindGroup, ...passes: Run[][]) {
    const encoder = device.createCommandEncoder()
    for (const runs of passes) {
      const pass = encoder.beginComputePass()
      pass.setBindGroup(0, group)
      for (const [pipeline, workgroups] of runs) {
        pass.setPipeline(pipeline)
        pass.dispatchWorkgroups(workgroups)
      }
      pass.end()
    }
    device.queue.submit([encoder.finish()])
  }

  /** The whole cut of `selection` on fresh buffers, read back. */
  async function cut(selection: SelectionCase): Promise<SelectionReading> {
    const { packed } = selection
    const { at, buffers, group, destroy } = bind(selection)
    const pages = groups(packed.pageCount)
    // The whole descent in one pass, as the engine encodes it: a thread per primitive, and at
    // least one per block of pages (it resets the block counts), then each level dispatched flat
    // over a bound of its node count. Then the kept leaves' pages, their verdict and the
    // requests' sort: `pageCount` bounds the candidate list and the live list.
    const levelRuns = Array.from({ length: Math.max(1, packed.levelSizes.length) }, (_, l): Run => [
      l >= LEVEL_QUEUES && l % LEVEL_QUEUES === 0 ? deeper : levels[l % LEVEL_QUEUES],
      groups(packed.nodeCount),
    ])
    dispatch(
      group,
      [[prepare, groups(Math.max(at.worldCount, pages))], ...levelRuns],
      [
        [wanted, pages],
        [mask, pages],
        [sort, 1],
      ],
    )
    const header = SELECTION_HEADER_WORDS
    const out = await readBuffer(device, buffers.out.buffer, 0, (header + packed.pageCount) * 4)
    const work = await readBuffer(device, buffers.work.buffer, 0, at.work.words * 4)
    // Draw flags, one per page, behind the descent queue (`queueCap` is the node count).
    const flags = await readBuffer(
      device,
      buffers.flags.buffer,
      packed.nodeCount * 4,
      packed.pageCount * 4,
    )
    const count = Math.min(out[OUT_COUNT], packed.pageCount)
    const requests = Array.from(out.subarray(header, header + count))
    // The staged pairs, page then priority, in the order the threads won the counter.
    const staged = await readBuffer(
      device,
      buffers.out.buffer,
      stagedRequestsWord(at.listCap) * 4,
      count * 8,
    )
    destroy()
    const priorityOf = new Map<number, number>()
    for (let s = 0; s < count; s++) priorityOf.set(staged[2 * s], staged[2 * s + 1])
    return {
      name: selection.name,
      requests,
      priorities: requests.map((page) => priorityOf.get(page) ?? -1),
      pages: [...requests].sort((a, b) => a - b),
      frustumRejected: out[OUT_FRUSTUM_REJECTED],
      overflow: out[OUT_FLAGS],
      selectedTriangles: out[OUT_SELECTED_TRIANGLES],
      transparentTriangles: out[OUT_TRANSPARENT_TRIANGLES],
      drawn: [...flags.keys()].filter((page) => flags[page]),
      candidates: work[at.work.candCounter],
      live: work[at.work.liveCounter],
    }
  }

  return {
    device,
    bind,
    cut,
    /** `dagSortRequests` alone on `group`: the requests its output holds staged, sorted. */
    sort: (group: GPUBindGroup) => dispatch(group, [[sort, 1]]),
    /** Waits for the queue, closes the device and returns the adapter. */
    async close() {
      const { court } = await gpu.fermer()
      assert.deepEqual(gpu.errors, [], 'the device reports no error')
      return court
    },
  }
}

/**
 * Runs the selection kernel — `shader`, the shipped one by default, or a variant to compare it
 * with — on every case, on one device, and returns the adapter and one reading per case, in order.
 */
export function runSelectionKernel(cases: SelectionCase[], shader = DAG_SELECTION_SHADER) {
  return runOnDawn(async () => {
    const kernel = await openSelectionKernel(shader)
    const readings: SelectionReading[] = []
    for (const selection of cases) readings.push(await kernel.cut(selection))
    return { adapter: await kernel.close(), readings }
  }, undefined)
}
