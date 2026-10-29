import type { PathTracingGpu } from './gpuState.ts'
import type { PathTracingSettings } from './framePlan.ts'
import type { PathTracingPipelines } from './pipelines.ts'

/** What the display of an image reads: the sample it is at, the pre-exposure of the run and of the image, the image of the ping-pong that holds the accumulation. */
export interface PathTracingDisplay {
  readonly iteration: number
  readonly baseExposure: number
  readonly preExposure: number
  readonly image: 0 | 1
}

/**
 * THE PATH TRACER'S DISPLAY drawn into the lit image `target` and the frame's depth `depth` (`ptDisplay`): one full-screen triangle that writes each pixel of the first `width` × `height` the accumulated radiance multiplied by the ratio
 * of the image's pre-exposure to the run's, with the error chain's views and the progress bar (`displayWgsl.ts`). It clears the target; in the wiper mode it loads it, and draws only to the right of the middle of the view
 * (the frame's own lighting is left to show to the left).
 */
export function drawPathTracingDisplay(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  pipelines: PathTracingPipelines,
  gpu: PathTracingGpu,
  settings: PathTracingSettings,
  display: PathTracingDisplay,
  target: GPUTextureView,
  depth: GPUTextureView,
) {
  const pipeline = pipelines.display.get()
  if (!pipeline) return
  const [width, height] = gpu.size
  const words = new ArrayBuffer(48)
  const floats = new Float32Array(words)
  const ints = new Uint32Array(words)
  floats.set([
    width,
    height,
    0,
    0,
    width,
    height,
    display.preExposure / display.baseExposure,
    settings.pathTracingAdaptiveSamplingErrorThreshold,
  ])
  ints.set(
    [
      Math.min(display.iteration, settings.pathTracingSamplesPerPixel),
      settings.pathTracingSamplesPerPixel,
      settings.pathTracingProgressDisplay ? 1 : 0,
    ],
    8,
  )
  new Int32Array(words)[11] =
    settings.pathTracingExperimental && settings.pathTracingAdaptiveSampling
      ? settings.pathTracingAdaptiveSamplingVisualize
      : 0
  device.queue.writeBuffer(gpu.display, 0, words)
  const images = gpu.images[display.image]
  const group = device.createBindGroup({
    layout: pipelines.displayLayout,
    entries: [
      { binding: 0, resource: { buffer: gpu.display } },
      { binding: 1, resource: images.radiance.createView() },
      { binding: 2, resource: images.variance.createView() },
      { binding: 3, resource: { buffer: gpu.varianceDims } },
      { binding: 4, resource: images.depth.createView() },
    ],
  })
  const wiper = settings.pathTracingWiperMode
  const pass = encoder.beginRenderPass({
    label: 'Trillion3D path tracer display',
    colorAttachments: [
      {
        view: target,
        loadOp: wiper ? 'load' : 'clear',
        storeOp: 'store',
        clearValue: [0, 0, 0, 0],
      },
    ],
    depthStencilAttachment: { view: depth, depthLoadOp: 'load', depthStoreOp: 'store' },
  })
  pass.setViewport(0, 0, width, height, 0, 1)
  if (wiper) {
    const from = Math.floor(width / 2)
    pass.setScissorRect(from, 0, width - from, height)
  }
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, group)
  pass.draw(3)
  pass.end()
}
