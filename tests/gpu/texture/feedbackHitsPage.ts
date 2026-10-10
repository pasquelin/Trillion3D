// The texture feedback on Dawn (`webgpu/tile/feedback.ts`, `reduce.ts`): a target of requested tile
// ranks reduced to counters, each tile listed once and gathered into the list that is read back.
import {
  createWebgpuTileFeedback,
  FEEDBACK_EVERY,
} from '../../../packages/sdk-browser/src/webgpu/tile/feedback.ts'
import { createWebgpuTileReduce } from '../../../packages/sdk-browser/src/webgpu/tile/reduce.ts'
import { openGpuDevice } from '../kit/webgpuDevice.ts'

/** One image's feedback: the requests the target holds (a rank plus one, 0 none), `images` times. */
export type FeedbackCase = {
  entries: number
  width: number
  height: number
  requests: number[]
  /** Ask every pixel (a convergence), else the pixels of the phase. */
  every: boolean
  images: number
  /** The requests of one last image, after the others. */
  then?: number[]
}

/** The tiles each image of `kase` listed, with the pixels that named them, and the capacity. */
export async function run(kase: FeedbackCase) {
  const gpu = await openGpuDevice()
  if (!gpu) throw new Error('no WebGPU adapter')
  const { device, errors } = gpu
  const { entries, width, height, every, images } = kase
  const feedback = createWebgpuTileFeedback(device, entries)
  const reduce = createWebgpuTileReduce(device)!
  const target = device.createTexture({
    size: [width, height],
    format: 'r32uint',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  })
  device.queue.writeTexture(
    { texture: target },
    Uint32Array.from(kase.requests),
    { bytesPerRow: width * 4 },
    [width, height],
  )
  const view = target.createView()
  const listed: { ranks: number[]; weights: number[] }[] = []
  for (let image = 0; image <= images; image++) {
    if (image === images) {
      if (!kase.then) break
      device.queue.writeTexture(
        { texture: target },
        Uint32Array.from(kase.then),
        { bytesPerRow: width * 4 },
        [width, height],
      )
    }
    const encoder = device.createCommandEncoder()
    reduce.encode(encoder, view, feedback, [width, height], feedback.phaseWord(every))
    feedback.encode(encoder)
    device.queue.submit([encoder.finish()])
    feedback.submitted()
    await feedback.settled()
    const hits = feedback.take()
    listed.push({
      ranks: hits ? Array.from(hits.index.subarray(0, hits.count)) : [],
      weights: hits ? Array.from(hits.weight.subarray(0, hits.count)) : [],
    })
  }
  const capacity = feedback.capacity
  feedback.destroy()
  reduce.destroy()
  const info = await gpu.fermer()
  return { adapter: info.court, errors, listed, capacity, every: FEEDBACK_EVERY }
}
