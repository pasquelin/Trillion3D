import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import { drawBlendRuns } from './draw.ts'
import { DISTORTION_APPLY_PASS, DISTORTION_PASS } from '../../stage/passLabels.ts'
import { DISTORTION_GROUP, type TransmitPipelines } from './stagePipelines.ts'
import { feedbackAttachment } from '../pages/prepare/attachments.ts'
import { activeAsIsShare, blendShareTargets } from '../pages/prepare/asIsShareTarget.ts'
import { distortionCovers, drawsDistortion } from './distortionDrawn.ts'

/**
 * The distortion, before the translucency is drawn over it: the offsets of the refracting layers of the image
 * accumulated into their half-float target — added, depth-tested against the opaque scene, no
 * depth written (`fsDistortion`), every transmissive layer with the companion pass's
 * outputs where `distortionCovers` —, then the opaque scene copied and drawn again full screen,
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
  const covers = distortionCovers(rt, transmission),
    share = covers ? activeAsIsShare(rt) : undefined,
    targets = share ? blendShareTargets(rt) : 0
  const pass = encoder.beginRenderPass({
    label: DISTORTION_PASS,
    colorAttachments: [
      {
        view: backdrop.distortionView,
        loadOp: 'clear',
        clearValue: [0, 0, 0, 0],
        storeOp: 'store',
      },
      // The companion pass's outputs, where the accumulation writes them (`distortionCovers`).
      covers && rt.vis.writesFeedback ? feedbackAttachment(rt) : null,
      share ? { view: share.view, loadOp: 'load', storeOp: 'store' } : null,
      share && targets === 2 ? { view: share.givenUpView, loadOp: 'load', storeOp: 'store' } : null,
    ],
    // The opaque depth, tested and read at once: a read-only attachment.
    depthStencilAttachment: { view: gpu.depthView!, depthReadOnly: true },
  })
  pass.setViewport(0, 0, width, height, 0, 1)
  pass.setBindGroup(DISTORTION_GROUP, transmission.distortionGroup(view, gpu.depthView!))
  const drawn = covers ? transmission.distortionCoverage : transmission.distortion
  const encoded = drawBlendRuns(rt, device, pass, drawn, { share: targets, reflected: false })
  pass.end()
  encoder.copyTextureToTexture({ texture: gpu.hdrTexture! }, { texture: backdrop.color }, [
    width,
    height,
  ])
  const apply = encoder.beginRenderPass({
    label: DISTORTION_APPLY_PASS,
    colorAttachments: [{ view: gpu.hdrView!, loadOp: 'load', storeOp: 'store' }],
  })
  apply.setViewport(0, 0, width, height, 0, 1)
  apply.setPipeline(transmission.apply.get())
  apply.setBindGroup(0, transmission.applyEmpty)
  apply.setBindGroup(
    DISTORTION_GROUP,
    transmission.applyGroup(view, backdrop.distortionView, backdrop.colorView),
  )
  apply.draw(3)
  apply.end()
  return encoded + 1
}
