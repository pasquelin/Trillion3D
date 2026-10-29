import type { DenoiseGpu } from './denoiseGpu.ts'
import type { DenoiseViews } from './encodeDenoise.ts'
import type { DenoisePipelines } from './denoisePipelines.ts'
import type { PathTracingSettings } from './framePlan.ts'

/**
 * THE DENOISER'S VIEWS drawn over the lit image `target` after the display (a full-screen triangle each, loaded and replaced): the motion the temporal stage found
 * (`pathTracingTemporalDenoiserVisualizeMotionVector`: a colour wheel by direction and length, arrows on a grid, the wheel's key in the corner) and the history warped by it
 * (`pathTracingTemporalDenoiserVisualizeWarp`). In the wiper mode they cover the left of the view, where the display does not draw.
 */
export function drawDenoiseViews(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  pipelines: DenoisePipelines,
  dgpu: DenoiseGpu,
  settings: PathTracingSettings,
  views: DenoiseViews,
  exposure: number,
  target: GPUTextureView,
) {
  const motion = settings.pathTracingTemporalDenoiserVisualizeMotionVector
  const warp = settings.pathTracingTemporalDenoiserVisualizeWarp !== 0
  if (!motion && !warp) return
  const [width, height] = dgpu.size
  device.queue.writeBuffer(dgpu.view, 0, new Float32Array([width, height, 0, 0, exposure, 0, 0, 0]))
  const group = device.createBindGroup({
    layout: pipelines.visualLayout,
    entries: [
      { binding: 0, resource: { buffer: dgpu.view } },
      { binding: 1, resource: views.motion },
      { binding: 2, resource: views.history },
    ],
  })
  for (const [wanted, view, label] of [
    [motion, pipelines.motionView, 'motion'],
    [warp, pipelines.warpView, 'warp'],
  ] as const) {
    const pipeline = view.get()
    if (!wanted || !pipeline) continue
    const pass = encoder.beginRenderPass({
      label: `Trillion3D path tracer denoiser ${label} view`,
      colorAttachments: [{ view: target, loadOp: 'load', storeOp: 'store' }],
    })
    pass.setViewport(0, 0, width, height, 0, 1)
    if (settings.pathTracingWiperMode) pass.setScissorRect(0, 0, Math.floor(width / 2), height)
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, group)
    pass.draw(3)
    pass.end()
  }
}
