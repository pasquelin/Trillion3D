/**
 * Image-feedback reduction: the target where each pixel — opaque by hardware resolve, transparent
 * by the blend pass — posted the rank of the tile it wants becomes per-tile counters. No fragment
 * stage writes memory: the blend pass would lose its early-z reject (`../blend/earlyRejection.test.ts`),
 * and resolve paid six atomic counters per phase pixel — six dependent-read chains and six contended
 * atomics, which the whole pixel group the GPU runs together waited on: the materials pass cost
 * twice as much at 2496×1404 (5.6 ms versus 2.8; 2.65 without this feedback). It is this
 * compute pass, one thread per phase pixel, that counts: one pixel in sixteen outside a barrier, all
 * of them during a convergence: the pixel writes its request and the analysis comes after. The
 * pixel that first counts a tile lists it; the gather (`gather`) then reads each listed tile's count
 * and zeroes its counter, so nothing is walked but the tiles asked.
 */
import { WORKGROUP_THREADS } from '../../gpu/dispatch/grid.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { FEEDBACK_EVERY, FEEDBACK_STRIDE, type WebgpuTileFeedback } from './feedback.ts'
import type { WebgpuTileAtlas } from './atlasTypes.ts'
import { GATHER_WGSL, REDUCE_WGSL, REDUCE_WORKGROUP } from './reduceWgsl.ts'
import { preparedComputePipeline, started } from '../../lighting/deferred/fullscreen.ts'
import { TEXTURE_FEEDBACK_REDUCE_PASS } from '../../stage/passLabels.ts'
import { createWebgpuBindIdentity } from '../core/bindIdentity.ts'
import {
  computeBufferEntry,
  computeTextureEntry,
  computeUniformEntry,
  sequentialEntries,
} from '../../gpu/core/computeBindings.ts'

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
    feedback: Pick<WebgpuTileFeedback, 'buffer' | 'list' | 'capacity'>,
    size: [number, number],
    phaseWord: number,
    stamp: TileStamp,
  ): void

  destroy(): void
}

/** The reduction of the image's request target, its pipelines compiled off the frame. */
export function createWebgpuTileReduce(device: GPUDevice): WebgpuTileReduce {
  const layout = device.createBindGroupLayout({
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
  const gatherLayout = device.createBindGroupLayout({
    entries: [
      computeBufferEntry(0, 'storage'),
      computeBufferEntry(1, 'storage'),
      computeUniformEntry(2),
    ],
  })
  const pipeline = started(
    preparedComputePipeline(device, {
      label: 'Trillion3D texture feedback reduce',
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      compute: { module: device.createShaderModule({ code: REDUCE_WGSL }), entryPoint: 'reduce' },
    }),
  )
  const gathering = started(
    preparedComputePipeline(device, {
      label: 'Trillion3D texture feedback gather',
      layout: device.createPipelineLayout({ bindGroupLayouts: [gatherLayout] }),
      compute: { module: device.createShaderModule({ code: GATHER_WGSL }), entryPoint: 'gather' },
    }),
  )
  const uniform = device.createBuffer({
    label: 'Trillion3D texture feedback reduce uniform',
    size: 32,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const gatherUniform = device.createBuffer({
    label: 'Trillion3D texture feedback gather uniform',
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const words = new Uint32Array(8),
    capWord = new Uint32Array(1)
  // The groups follow the target and the buffers: rebuilt when one moved (`bindIdentity.ts`).
  const reduced = createWebgpuBindIdentity(),
    gatherBound = createWebgpuBindIdentity()
  let group: GPUBindGroup | undefined, gathered: GPUBindGroup | undefined
  return {
    encode(encoder, target, feedback, size, phaseWord, stamp) {
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
        group = device.createBindGroup({
          layout,
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
      const every = (phaseWord & FEEDBACK_EVERY) !== 0
      const cols = every ? size[0] : ceilDiv(size[0], FEEDBACK_STRIDE),
        rows = every ? size[1] : ceilDiv(size[1], FEEDBACK_STRIDE)
      const pass = encoder.beginComputePass({ label: TEXTURE_FEEDBACK_REDUCE_PASS })
      pass.setPipeline(pipeline.get())
      pass.setBindGroup(0, group!)
      pass.dispatchWorkgroups(ceilDiv(cols, REDUCE_WORKGROUP), ceilDiv(rows, REDUCE_WORKGROUP))
      // The dispatches of a pass run in order, the storage a reduction wrote read by the gather.
      if (feedback.capacity > 0) {
        gatherBound.next[0] = feedback.buffer
        gatherBound.next[1] = feedback.list
        if (gatherBound.moved())
          gathered = device.createBindGroup({
            layout: gatherLayout,
            entries: sequentialEntries([
              { buffer: feedback.buffer },
              { buffer: feedback.list },
              { buffer: gatherUniform },
            ]),
          })
        capWord[0] = feedback.capacity
        device.queue.writeBuffer(gatherUniform, 0, capWord)
        pass.setPipeline(gathering.get())
        pass.setBindGroup(0, gathered!)
        pass.dispatchWorkgroups(ceilDiv(feedback.capacity, WORKGROUP_THREADS))
      }
      pass.end()
    },
    destroy() {
      uniform.destroy()
      gatherUniform.destroy()
    },
  }
}
