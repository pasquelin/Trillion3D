/**
 * Image-feedback reduction: the target where each pixel — opaque by hardware resolve, transparent
 * by the blend pass — posted the rank of the tile it wants becomes per-tile counters. No fragment
 * stage writes memory: the blend pass would lose its early-z reject (`../../blend/earlyRejection.test.ts`),
 * and resolve paid six atomic counters per phase pixel — six dependent-read chains and six contended
 * atomics, which the whole pixel group the GPU runs together waited on: the materials pass cost
 * twice as much at 2496×1404 (5.6 ms versus 2.8; 2.65 without this feedback). It is this
 * compute pass, one thread per phase pixel, that counts: one pixel in 256 outside a barrier, all
 * of them during a convergence: the pixel writes its request and the analysis comes after. The
 * pixel that first counts a tile lists it; the gather (`gather`) then reads each listed tile's count
 * and zeroes its counter, so nothing is walked but the tiles asked.
 */
import { dispatchRows, WORKGROUP_THREADS } from '../../gpu/dispatch/grid.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { feedbackStrideOf, type WebgpuTileFeedback } from './feedback.ts'
import type { WebgpuTileAtlas } from './atlas/atlasTypes.ts'
import { GATHER_WGSL, REDUCE_WGSL, REDUCE_WORKGROUP } from './reduceWgsl.ts'
import { chainReady, started } from '../../lighting/deferred/fullscreen.ts'
import { preparedComputeStage } from '../../gpu/core/computeStages.ts'
import { TEXTURE_FEEDBACK_REDUCE_PASS } from '../../diagnostic/stage/passLabels.ts'
import { createWebgpuBindIdentity } from '../../gpu/bind/bindIdentity.ts'
import {
  computeBufferEntry,
  computeTextureEntry,
  computeUniformEntry,
  sequentialEntries,
} from '../../gpu/core/computeBindings.ts'

const PASS: GPUComputePassDescriptor = { label: TEXTURE_FEEDBACK_REDUCE_PASS }

/** Where the reduction stamps the places its pixels read (`stampWgsl.ts`): the clock, and the
 *  colour then the data atlas — its table and its places' words. */
type TileStamp = {
  clock: number
  atlases: readonly Pick<WebgpuTileAtlas, 'pages' | 'slotUse'>[]
}

export type WebgpuTileReduce = {
  /** Encodes reduction of the target into the feedback's counters and list, for the image's phase,
   *  then the gather of the listed tiles' counts, in the same pass. */
  encode(
    encoder: GPUCommandEncoder,
    target: GPUTextureView,
    feedback: ReduceFeedback,
    size: [number, number],
    phaseWord: number,
    stamp: TileStamp,
  ): void

  /** Whether the reduction and the gather are compiled (asked now where not): an image whose
   *  reduction cannot run posts, ranks and stamps nothing (`createTilePublish`). */
  ready(): boolean
  destroy(): void
}

type ReduceFeedback = Pick<WebgpuTileFeedback, 'buffer' | 'list' | 'capacity'>

/** The layout of the reduction's group: the target, the counters, the uniform, the list and the atlases'
 *  tables and places. */
const reduceLayoutOf = (device: GPUDevice) =>
  device.createBindGroupLayout({
    entries: [
      computeTextureEntry(0, 'uint'),
      computeBufferEntry(1, 'storage'),
      computeUniformEntry(2),
      computeBufferEntry(3, 'storage'),
      computeBufferEntry(4, 'read-only-storage'),
      computeBufferEntry(5, 'read-only-storage'),
      computeBufferEntry(6, 'storage'),
      computeBufferEntry(7, 'storage'),
    ],
  })

/** The layout of the gather's group: the counters, the list and the uniform. */
const gatherLayoutOf = (device: GPUDevice) =>
  device.createBindGroupLayout({
    entries: [
      computeBufferEntry(0, 'storage'),
      computeBufferEntry(1, 'storage'),
      computeUniformEntry(2),
    ],
  })

/** A compute stage over `bound` alone, started. */
const reduceStageOf = (
  device: GPUDevice,
  bound: GPUBindGroupLayout,
  module: GPUShaderModule,
  entry: string,
  label: string,
) =>
  started(
    preparedComputeStage(
      device,
      device.createPipelineLayout({ bindGroupLayouts: [bound] }),
      module,
      entry,
      undefined,
      label,
    ),
  )

/** The reduction's layouts, pipelines, buffers and the groups that follow the target. */
function createReduceState(device: GPUDevice) {
  const layout = reduceLayoutOf(device)
  const gatherLayout = gatherLayoutOf(device)
  return {
    device,
    layout,
    gatherLayout,
    pipeline: reduceStageOf(
      device,
      layout,
      device.createShaderModule({ code: REDUCE_WGSL }),
      'reduce',
      'Trillion3D texture feedback reduce',
    ),
    gathering: reduceStageOf(
      device,
      gatherLayout,
      device.createShaderModule({ code: GATHER_WGSL }),
      'gather',
      'Trillion3D texture feedback gather',
    ),
    uniform: device.createBuffer({
      label: 'Trillion3D texture feedback reduce uniform',
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    }),
    gatherUniform: device.createBuffer({
      label: 'Trillion3D texture feedback gather uniform',
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    }),
    words: new Uint32Array(8),
    capWord: new Uint32Array(1),
    // The groups follow the target and the buffers: rebuilt when one moved (`bindIdentity.ts`).
    reduced: createWebgpuBindIdentity(),
    gatherBound: createWebgpuBindIdentity(),
    group: undefined as GPUBindGroup | undefined,
    gathered: undefined as GPUBindGroup | undefined,
  }
}
type ReduceState = ReturnType<typeof createReduceState>

/** The reduction's group over the target and the feedback's buffers, its uniform written. */
function bindReduce(
  st: ReduceState,
  target: GPUTextureView,
  feedback: ReduceFeedback,
  size: [number, number],
  phaseWord: number,
  stamp: TileStamp,
) {
  const { device, uniform, words, reduced } = st
  const [color, data] = stamp.atlases
  const next = reduced.next
  next[0] = target
  next[1] = feedback.buffer
  next[2] = feedback.list
  next[3] = color.pages.buffer
  next[4] = data.pages.buffer
  next[5] = color.slotUse.buffer
  next[6] = data.slotUse.buffer
  if (reduced.moved())
    st.group = device.createBindGroup({
      layout: st.layout,
      entries: sequentialEntries([
        target,
        { buffer: feedback.buffer },
        { buffer: uniform },
        { buffer: feedback.list },
        { buffer: color.pages.buffer },
        { buffer: data.pages.buffer },
        { buffer: color.slotUse.buffer },
        { buffer: data.slotUse.buffer },
      ]),
    })
  words[0] = size[0]
  words[1] = size[1]
  words[2] = phaseWord
  words[3] = feedback.capacity
  words[4] = stamp.clock
  device.queue.writeBuffer(uniform, 0, words)
}

/** The gather of the listed tiles' counts, in `pass`. */
function encodeGather(st: ReduceState, pass: GPUComputePassEncoder, feedback: ReduceFeedback) {
  const { device, gatherBound, gatherUniform, capWord } = st
  gatherBound.next[0] = feedback.buffer
  gatherBound.next[1] = feedback.list
  if (gatherBound.moved())
    st.gathered = device.createBindGroup({
      layout: st.gatherLayout,
      entries: sequentialEntries([
        { buffer: feedback.buffer },
        { buffer: feedback.list },
        { buffer: gatherUniform },
      ]),
    })
  // The capacity changes only when the list grows: written then, not every frame.
  if (capWord[0] !== feedback.capacity) {
    capWord[0] = feedback.capacity
    device.queue.writeBuffer(gatherUniform, 0, capWord)
  }
  pass.setPipeline(st.gathering.get()!)
  pass.setBindGroup(0, st.gathered!)
  dispatchRows(pass, ceilDiv(feedback.capacity, WORKGROUP_THREADS))
}

/** The reduction of the image's request target, its pipelines compiled off the frame. */
export function createWebgpuTileReduce(device: GPUDevice): WebgpuTileReduce {
  const st = createReduceState(device)
  return {
    ready: () => chainReady(st.pipeline, st.gathering),
    encode(encoder, target, feedback, size, phaseWord, stamp) {
      bindReduce(st, target, feedback, size, phaseWord, stamp)
      const stride = feedbackStrideOf(phaseWord)
      const cols = ceilDiv(size[0], stride),
        rows = ceilDiv(size[1], stride)
      const pass = encoder.beginComputePass(PASS)
      pass.setPipeline(st.pipeline.get()!)
      pass.setBindGroup(0, st.group!)
      pass.dispatchWorkgroups(ceilDiv(cols, REDUCE_WORKGROUP), ceilDiv(rows, REDUCE_WORKGROUP))
      // The dispatches of a pass run in order, the storage a reduction wrote read by the gather.
      if (feedback.capacity > 0) encodeGather(st, pass, feedback)
      pass.end()
    },
    destroy() {
      st.uniform.destroy()
      st.gatherUniform.destroy()
    },
  }
}
