import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { drawVis } from './drawVis.ts'

/**
 * The hardware raster's pass `label`: the halves `halves` (`rest` false the main pass's) drawn
 * in the phase `ids` of the visibility write, over the depth target held read-only — the pass's
 * one attachment; the fragments write the visibility buffer alone.
 */
export function encodeHardwareRaster(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  label: string,
  halves: readonly boolean[],
  ids: boolean,
) {
  const { gpu } = rt,
    [width, height] = gpu.targetSize
  const pass = encoder.beginRenderPass({
    label,
    colorAttachments: [],
    depthStencilAttachment: { view: gpu.depthView!, depthReadOnly: true },
  })
  pass.setViewport(0, 0, width, height, 0, 1)
  for (const rest of halves) drawVis(rt, device, pass, rest, ids)
  pass.end()
}
