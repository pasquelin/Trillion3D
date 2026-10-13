/**
 * THE ROWS PASS ON THE GPU (`rowWordsWgsl.ts`): a thread a row the CPU named this frame
 * (`rowWords.ts`) — or every caster row, when a buffer it writes or reads was made anew —, then a
 * thread a row of the roots a parent composes once their worlds moved (`composedRows.ts`). It runs
 * in the frame's command buffer after the compose worlds pass and before any reader of the words.
 */
import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import { grownLength } from '../../../math/src/sequence/resized.ts'
import { dispatchRows } from '../gpu/dispatch/grid.ts'
import { oncePerDevice } from '../gpu/core/oncePerDevice.ts'
import { preparedComputePipeline } from '../lighting/deferred/fullscreen.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import { COMPOSE_ROWS_PASS } from '../stage/passLabels.ts'
import {
  DERIVE_ROWS_ENTRY,
  DERIVE_ROWS_WGSL,
  PART_CORNERS,
  PART_LODS,
  PART_SPHERES,
} from './rowWordsWgsl.ts'
import { composeGroup } from './composeGroups.ts'
import { createRowWordsGpu, partsMoved, rowEntries, type RowWordsGpu } from './rowWordsGpu.ts'
import { followComposedRows, sendList } from './composedRows.ts'
import type { RowWords } from './rowWords.ts'
import { writeMovedRoots } from './rootPasses.ts'

/** The rows kernel, once a device, compiled off the thread (`askRowWords`). */
const rowsKernel = oncePerDevice((device) =>
  preparedComputePipeline(device, {
    label: COMPOSE_ROWS_PASS,
    layout: 'auto',
    compute: {
      module: device.createShaderModule({ label: COMPOSE_ROWS_PASS, code: DERIVE_ROWS_WGSL }),
      entryPoint: DERIVE_ROWS_ENTRY,
    },
  }),
)

/** Asks the rows kernel at a frame's entry once the table holds a row
 *  (`../webgpu/frame/framePipelines.ts`). */
export function askRowWords(rt: WebgpuPagesRuntime, device: GPUDevice) {
  if (rt.layout.rows.casterSlots) rowsKernel(device).ask()
}

/** The rows the CPU named, sent; a list made again when they outgrow it. */
function sendTargets(device: GPUDevice, gpu: RowWordsGpu, state: RowWords) {
  if (state.all || !state.count) return
  if (!gpu.list || gpu.list.size < state.count * 4) {
    gpu.list?.destroy()
    gpu.list = device.createBuffer({
      label: 'Trillion3D rows pass list',
      size: grownLength(gpu.list ? gpu.list.size : 0, state.count * 4),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
  }
  device.queue.writeBuffer(gpu.list, 0, state.targets, 0, state.count)
}

/** The rows of the composed roots the pass derives this frame: all of them on the first frame
 *  after the compose worlds pass wrote worlds it had not derived them at, none otherwise. */
function composedRows(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const state = rt.compose,
    gpu = state?.gpu
  if (!state?.parentIds.size || !gpu?.parents) return 0
  followComposedRows(rt, state)
  gpu.rowList = sendList(device, gpu.rowList, 'Trillion3D composed rows', state.rowList)
  if (state.ranAt.worlds !== state.composedAt || state.ranAt.rows === state.composedAt) return 0
  state.ranAt.rows = state.composedAt
  return state.rowList.set.count
}

/** Dispatch `g` of the pass over `listed` rows, `all` of the table or those its list names. */
function dispatch(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  pass: GPUComputePassEncoder,
  { gpu, pipeline, g, listed, all }: RowDispatch,
) {
  const words = gpu.words[g]
  words[0] = rt.layout.selectionRoots.length
  words[1] =
    (gpu.frame[0] ? PART_SPHERES : 0) |
    (gpu.frame[1] ? PART_CORNERS : 0) |
    (gpu.frame[2] ? PART_LODS : 0)
  words[2] = listed
  words[3] = all ? 1 : 0
  device.queue.writeBuffer(gpu.params[g], 0, words)
  const held = gpu.groups[g]
  held.identity.entries[0] ??= rowEntries(rt, gpu, g)
  composeGroup(device, held, pipeline)
  pass.setBindGroup(0, held.group!)
  dispatchRows(pass, ceilDiv(listed, 64))
  rt.run.gpuComputeDispatches++
}
type RowDispatch = {
  gpu: RowWordsGpu
  pipeline: GPUComputePipeline
  g: number
  listed: number
  all: boolean
}

/**
 * The rows pass, before anything reads a row's words this frame: the named rows — every caster row
 * when a buffer it binds was made anew —, then the composed rows when their worlds moved. Nothing
 * on a frame where no row was written and no root moved.
 */
export function encodeRowWords(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
) {
  const state = rt.rowWords,
    worlds = rt.rootWorlds,
    { rows } = rt.layout
  if (!state?.inputs.buffer || !worlds?.worlds || !rt.vis.pageTable || !rows.casterSlots) return
  // The root boxes the detail reads, of a world moved since the cut wrote them, first.
  writeMovedRoots(rt)
  const gpu = (state.gpu ??= createRowWordsGpu(device))
  gpu.frame[0] = rt.lights.spheres?.buffer
  gpu.frame[1] = rt.vis.gpuPartition?.corners
  gpu.frame[2] = rt.lights.rowLods?.buffer
  if (partsMoved(rt, gpu)) state.all = true
  const composed = composedRows(rt, device)
  const all = state.all,
    listed = all ? rows.casterSlots : state.count
  if (!listed && !composed) return
  sendTargets(device, gpu, state)
  const pipeline = rowsKernel(device).get()
  const pass = encoder.beginComputePass({ label: COMPOSE_ROWS_PASS })
  pass.setPipeline(pipeline)
  if (listed) dispatch(rt, device, pass, { gpu, pipeline, g: 0, listed, all })
  if (composed && !all) dispatch(rt, device, pass, { gpu, pipeline, g: 1, listed: composed, all })
  pass.end()
  state.all = false
  state.count = 0
  state.encodedInto = encoder
}
