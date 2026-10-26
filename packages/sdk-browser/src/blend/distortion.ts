import type { WebgpuPagesRuntime } from '../frame/backend/runtime.ts'
import { heldColour } from '../gpu/core/heldAttachment.ts'
import { chainReady } from '../lighting/deferred/fullscreen.ts'
import { drawBlendRuns } from './draw.ts'
import { DISTORTION_APPLY_PASS, DISTORTION_PASS } from '../diagnostic/stage/passLabels.ts'
import { DISTORTION_GROUP, type TransmitPipelines } from './stagePipelines.ts'
import { drawsDistortion } from './distortionDrawn.ts'

const distortionTarget = heldColour({ loadOp: 'clear', clearValue: [0, 0, 0, 0], storeOp: 'store' })
const distortionDepth = { depthReadOnly: true } as GPURenderPassDepthStencilAttachment
const DISTORTION: GPURenderPassDescriptor = {
  label: DISTORTION_PASS,
  colorAttachments: [distortionTarget],
  depthStencilAttachment: distortionDepth,
}
const applyTarget = { loadOp: 'load', storeOp: 'store' } as GPURenderPassColorAttachment
const APPLY: GPURenderPassDescriptor = {
  label: DISTORTION_APPLY_PASS,
  colorAttachments: [applyTarget],
}

/**
 * The distortion, before the translucency is drawn over it: the offsets of the refracting layers of the image
 * accumulated into their half-float target — added, depth-tested against the opaque scene, no
 * depth written (`fsDistortion`), then the opaque scene copied and drawn again full screen,
 * moved by them, where one was accumulated (`fsDistortionApply`, the fragment's drop sparing the pixels
 * nothing bent). Refraction moves the opaque scene alone: every translucent layer is drawn
 * over it after. None where the image draws no distortion (`drawsDistortion`). Returns the draws
 * encoded.
 */
export function encodeDistortion(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  transmission: TransmitPipelines | undefined,
) {
  if (!drawsDistortion(rt, transmission)) return 0
  const { gpu } = rt,
    backdrop = gpu.backdrop!,
    view = gpu.deferred!.uniform!
  const [width, height] = gpu.targetSize
  distortionTarget.view = backdrop.distortionView
  // The opaque depth, tested and read at once: a read-only attachment.
  distortionDepth.view = gpu.depthView!
  // The accumulation, the scene copy and the application are one chain: none runs while a program
  // of it compiles, the frames waiting for it.
  if (!chainReady(...transmission.distortionChain())) return 0
  const applying = transmission.apply.get()!
  const pass = encoder.beginRenderPass(DISTORTION)
  pass.setViewport(0, 0, width, height, 0, 1)
  pass.setBindGroup(DISTORTION_GROUP, transmission.distortionGroup(view, gpu.depthView!))
  const encoded = drawBlendRuns(rt, device, pass, transmission.distortion, { reflected: false })
  pass.end()
  encoder.copyTextureToTexture({ texture: gpu.hdrTexture! }, { texture: backdrop.color }, [
    width,
    height,
  ])
  applyTarget.view = gpu.hdrView!
  const apply = encoder.beginRenderPass(APPLY)
  apply.setViewport(0, 0, width, height, 0, 1)
  apply.setPipeline(applying)
  apply.setBindGroup(0, transmission.applyEmpty)
  apply.setBindGroup(
    DISTORTION_GROUP,
    transmission.applyGroup(view, backdrop.distortionView, backdrop.colorView),
  )
  apply.draw(3)
  apply.end()
  return encoded + 1
}
