import { heldColour } from '../../gpu/core/heldAttachment.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { DEPTH_CLEAR } from '../../camera/depthConvention.ts'
import { drawVis } from './drawVis.ts'

const idsTarget = heldColour({
  loadOp: 'clear',
  storeOp: 'store',
  clearValue: { r: 0, g: 0, b: 0, a: 0 },
})
const idsTargets = [idsTarget]
const NO_TARGETS: GPURenderPassColorAttachment[] = []
const drawnDepth: GPURenderPassDepthStencilAttachment = {
  view: undefined as never,
  depthLoadOp: 'clear',
  depthStoreOp: 'store',
  depthClearValue: DEPTH_CLEAR,
}
const readDepth: GPURenderPassDepthStencilAttachment = {
  view: undefined as never,
  depthReadOnly: true,
}
/** The hardware raster's descriptor, held: the main pass clears, the post pass loads, a see-through
 *  image only reads the depth. */
const HARDWARE: GPURenderPassDescriptor = { colorAttachments: [] }

/**
 * The hardware raster's pass `label` over the half `rest` (false the main pass's): on a device with
 * the 64-bit atomic maximum, over the depth target held read-only — the pass's one attachment; the
 * fragments write the visibility buffer alone. On a device without it, each triangle is drawn once,
 * into the identifiers target the raster owns and the scene's depth attachment, with the hardware
 * depth test: the main pass's half clears both, the post pass's loads what the main pass drew.
 */
export function encodeHardwareRaster(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  label: string,
  rest: boolean,
) {
  const { gpu } = rt,
    [width, height] = gpu.targetSize,
    ids = rt.vis.gpuRaster!.hardwareIds
  const load = rest ? 'load' : 'clear'
  HARDWARE.label = label
  if (ids) {
    idsTarget.view = ids
    idsTarget.loadOp = load
    HARDWARE.colorAttachments = idsTargets
    drawnDepth.view = gpu.depthView!
    drawnDepth.depthLoadOp = load
    HARDWARE.depthStencilAttachment = drawnDepth
  } else {
    HARDWARE.colorAttachments = NO_TARGETS
    readDepth.view = gpu.depthView!
    HARDWARE.depthStencilAttachment = readDepth
  }
  const pass = encoder.beginRenderPass(HARDWARE)
  pass.setViewport(0, 0, width, height, 0, 1)
  drawVis(rt, device, pass, rest)
  pass.end()
}
