// The DAG selection kernel run on the GPU: the device and its pipelines opened once, then for each
// case its buffers as the engine lays them out (`selectionCase.ts`), the stages `dagPrepare`, the
// level descent, `dagWanted` — which appends the clusters it draws to the list of visible clusters —,
// `dagFinish` and `dagDrawn` in the engine's order (`geometry/dag/encode.ts`) for a cut in one pass
// that starts from fresh buffers, under no pyramid (`geometry/dag/occlusion.ts`), then the readout,
// the frame counters and the list of visible clusters read back.
import { WORKGROUP_THREADS } from '../../../packages/sdk-browser/src/gpu/dispatch/grid.ts'
import { readGpuBuffer } from '../../../packages/sdk-browser/src/gpu/core/readback.ts'
import assert from 'node:assert/strict'
import { DAG_SELECTION_SHADER } from '../../../packages/sdk-browser/src/geometry/dag/shader/selectionShader.fixture.ts'
import { dagBindEntries } from '../../../packages/sdk-browser/src/geometry/dag/shader/bindings.ts'
import { OCCLUSION_GROUP } from '../../../packages/sdk-browser/src/geometry/dag/shader/occlusionWgsl.ts'
import { createCutOcclusion } from '../../../packages/sdk-browser/src/geometry/dag/occlusion.ts'
import {
  countWord,
  priorityWord,
  SELECTION_HEADER_WORDS,
} from '../../../packages/sdk-browser/src/geometry/dag/readoutWords.ts'
import { LEVEL_QUEUES } from '../../../packages/sdk-browser/src/geometry/dag/shader/levelWgsl.ts'
import { COUNTER } from '../../../packages/sdk-browser/src/geometry/dag/shader/floorWgsl.ts'
import { VISIBLE_RECORD_WORDS } from '../../../packages/sdk-browser/src/geometry/dag/visible/layout.ts'
import {
  VIS_HW,
  VIS_SW,
  VISIBLE_HEADER_WORDS,
} from '../../../packages/sdk-browser/src/geometry/dag/visible/layout.fixture.ts'
import {
  OUT_COUNT,
  OUT_FLAGS,
  OUT_FRUSTUM_REJECTED,
  OUT_SELECTED_TRIANGLES,
  OUT_TRANSPARENT_TRIANGLES,
} from '../../../packages/sdk-browser/src/geometry/dag/layout.ts'
import { runOnDawn } from '../../kit/device/onDawn.ts'
import { openGpuDevice } from '../../kit/device/webgpuDevice.ts'
import { bindCase, type SelectionCase } from './selectionCase.ts'
import { workgroupCount } from '../../../packages/math/src/scalar/integers.ts'

/** What one case's cut left on the GPU. */
interface SelectionReading {
  name: string
  /** Requested pages, request after request in the order the GPU's threads asked them — each
   *  leaf's pages from its first (`countWord`) —, a whole word each. */
  requests: number[]
  /** Each page's priority word: its request's, read at the same rank of the priority list. */
  priorities: number[]
  /** The requested pages, in increasing order. */
  pages: number[]
  frustumRejected: number
  overflow: number
  selectedTriangles: number
  transparentTriangles: number
  /** The pages of the clusters `dagWanted` listed visible, each once, in increasing order. */
  drawn: number[]
  /** The descent's candidates and the clusters `dagWanted` listed visible: what the frame rereads. */
  candidates: number
  live: number
}

/**
 * Opens the device and builds the kernel's pipelines once — `shader`, the shipped one by default,
 * or a variant to compare it with — for every cut a proof runs on them. A device that is missing or
 * a text that does not compile fails the opening; a GPU error fails `close`.
 */
async function openSelectionKernel(shader = DAG_SELECTION_SHADER) {
  const gpu = await openGpuDevice()
  assert.ok(gpu, 'WebGPU must be available')
  const { device } = gpu
  const { module, compilation } = await gpu.compile(shader)
  assert.deepEqual(compilation, [], 'the selection kernel compiles')
  const layout = device.createBindGroupLayout({ entries: dagBindEntries() })
  // The stages that read the pyramid read the blank one: nothing is hidden, nothing held for a post
  // pass. One layout of both groups serves every stage.
  const occlusion = createCutOcclusion(device),
    noPyramid = occlusion.group(undefined)
  const pipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [layout, occlusion.layout],
  })
  const stage = (entryPoint: string) =>
    device.createComputePipeline({ layout: pipelineLayout, compute: { module, entryPoint } })
  // Level 0 is the root level, as the engine encodes it (`geometry/dag/encode.ts`): the queue's slots,
  // a grouped placement's left to its kept group (`placementTreeWgsl.ts`).
  const prepare = stage('dagPrepare'),
    levels = Array.from({ length: LEVEL_QUEUES }, (_, q) => stage(`dagLevel${q}`)),
    wanted = stage('dagWanted'),
    finish = stage('dagFinish'),
    drawn = stage('dagDrawn')
  const groups = (threads: number) => workgroupCount(threads, WORKGROUP_THREADS)

  const bind = (selection: SelectionCase) => bindCase(device, layout, selection)

  type Run = [GPUComputePipeline, number]
  /** Encodes `passes` on `group` and submits them: each a compute pass of its runs, a pipeline
   *  and its workgroups each, every dispatch seeing what the one before wrote. */
  function dispatch(group: GPUBindGroup, ...passes: Run[][]) {
    const encoder = device.createCommandEncoder()
    for (const runs of passes) {
      const pass = encoder.beginComputePass()
      pass.setBindGroup(0, group)
      pass.setBindGroup(OCCLUSION_GROUP, noPyramid)
      for (const [pipeline, workgroups] of runs) {
        pass.setPipeline(pipeline)
        pass.dispatchWorkgroups(workgroups)
      }
      pass.end()
    }
    device.queue.submit([encoder.finish()])
  }

  /** The whole cut of `selection` on fresh buffers, read back; `then`, when given, runs on its
   *  buffers and group once the cut is read, before they are freed. */
  async function cut(
    selection: SelectionCase,
    then?: (bound: ReturnType<typeof bind>, reading: SelectionReading) => Promise<void>,
  ): Promise<SelectionReading> {
    const { packed } = selection
    const bound = bind(selection)
    const { at, buffers, group, destroy } = bound
    const pages = groups(packed.pageCount)
    // The whole descent in one pass, as the engine encodes it: a thread per primitive, and at
    // least one per block of pages (it resets the block counts), then each level dispatched flat
    // over a bound of its entries, a placement's node each. Then the kept leaves' pages and their
    // verdict: `pageCount` bounds the candidate list and the list of visible clusters.
    const levelRuns = Array.from({ length: Math.max(1, packed.levelSizes.length) }, (_, l): Run => [
      levels[l % LEVEL_QUEUES],
      groups(packed.entryCount),
    ])
    dispatch(
      group,
      [[prepare, groups(Math.max(at.worldCount, pages))], ...levelRuns],
      [
        [wanted, pages],
        // The peaks and the clusters drawn counted, then the drawn list, a thread a visible cluster
        // (`shader/finishWgsl.ts`).
        [finish, 1],
        [drawn, pages],
      ],
    )
    const header = SELECTION_HEADER_WORDS
    const out = (await readGpuBuffer(device, buffers.out.buffer, (header + packed.pageCount) * 4))!
    const work = (await readGpuBuffer(device, buffers.work.buffer, at.work.words * 4))!
    // The list of visible clusters: its counts, then a record each — the software raster's from
    // the start, the hardware raster's from the end (`geometry/dag/visible/layout.ts`).
    const list = (await readGpuBuffer(device, buffers.visible.buffer, at.visible))!,
      room = Math.floor((list.length - VISIBLE_HEADER_WORDS) / VISIBLE_RECORD_WORDS),
      software = Math.min(list[VIS_SW], room),
      hardware = Math.min(list[VIS_HW], room - software)
    const listed = new Set<number>()
    const pageAt = (index: number) =>
      listed.add(list[VISIBLE_HEADER_WORDS + VISIBLE_RECORD_WORDS * index])
    for (let k = 0; k < software; k++) pageAt(k)
    for (let k = 0; k < hardware; k++) pageAt(room - 1 - k)
    const count = Math.min(out[OUT_COUNT], packed.pageCount)
    const firsts = Array.from(out.subarray(header, header + count))
    // Each request's priority and page count at its rank of their lists (`priorityWord`,
    // `countWord`). None asked reads nothing: a readback of no byte is none.
    const listAt = async (word: number) =>
      count
        ? (await readGpuBuffer(device, buffers.out.buffer, count * 4, word * 4))!
        : new Uint32Array(0)
    const requestPriorities = await listAt(priorityWord(at.listCap)),
      counts = await listAt(countWord(at.listCap))
    // The pages the requests name, one by one, each at its request's priority.
    const requests: number[] = [],
      priorities: number[] = []
    firsts.forEach((first, rank) => {
      for (let k = 0; k < counts[rank]; k++) {
        requests.push(first + k)
        priorities.push(requestPriorities[rank])
      }
    })
    const reading: SelectionReading = {
      name: selection.name,
      requests,
      priorities,
      pages: [...requests].sort((a, b) => a - b),
      frustumRejected: out[OUT_FRUSTUM_REJECTED],
      overflow: out[OUT_FLAGS],
      selectedTriangles: out[OUT_SELECTED_TRIANGLES],
      transparentTriangles: out[OUT_TRANSPARENT_TRIANGLES],
      drawn: [...listed].sort((a, b) => a - b),
      candidates: work[at.work.base + COUNTER.cand],
      live: software + hardware,
    }
    await then?.(bound, reading)
    destroy()
    return reading
  }

  return {
    device,
    /** The kernel's group layout and program: what a proof compiles the rows' closure on. */
    layout,
    module,
    bind,
    cut,
    /** Waits for the queue, closes the device and returns the adapter. */
    async close() {
      occlusion.dispose()
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
