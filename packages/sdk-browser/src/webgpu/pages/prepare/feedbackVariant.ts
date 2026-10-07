import { FEEDBACK_BYTES } from '../../../scene/surfaceBuffer.ts'
import { SHADE_SHADER } from '../../../visibility/buffer.ts'
import { createWebgpuBlendPipelines } from '../../blend/pipelines.ts'
import { shadeWithoutFeedbackCode } from '../../visibility/shaders.ts'
import { createWebgpuShadePipelines } from '../../visibility/shadePipelines.ts'
import { blendWritesShare } from './asIsShareTarget.ts'
import { blendContext } from './contractLight.ts'
import { makeFeedbackTarget } from './targets.ts'
import { keepsEveryOutput } from './emissiveAoLayer.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'

/** The pipelines of one feedback variant: those a frame binds, swapped as one. */
export type FeedbackPipelines = Pick<WebgpuPagesRuntime['vis'], 'shadeClasses' | 'blendPipelines'> &
  Pick<WebgpuPagesRuntime['blendState'], 'water'>

/** The other variant, asked when the scene's textures came or went: built aside, `set` once ready,
 *  its resolve with the emission-and-occlusion layer or without (`emissiveAo`). */
export type FeedbackAside = { feedback: boolean; emissiveAo: boolean; set?: FeedbackPipelines }

/**
 * Whether the scene's pipelines should write the texture feedback: a pixel asks a tile only of a
 * texture it wears, so a scene that wears none has nothing to ask, no target to clear and no
 * reduction to run. While the feedback A/B runs, its arm decides; its session, and a diagnostic
 * variant — whose stages have no twin without the output —, keep the feedback.
 */
export function wantsFeedback(rt: WebgpuPagesRuntime) {
  if (rt.feedbackAB) return rt.feedbackAB.target
  return keepsEveryOutput(rt) || rt.vis.mapLayer.size + rt.vis.dataLayer.size > 0
}

/** Brings the drawn view's feedback target to the pipelines in place (`vis.writesFeedback`): made
 *  beside its other targets when they write it, released when they no longer do — the others are
 *  never remade for it —, and what the targets cost follows. */
export function syncFeedbackTarget(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { gpu, vis } = rt
  if (!gpu.hdrTexture || !!gpu.feedbackTexture === vis.writesFeedback) return
  const [width, height] = gpu.allocatedSize
  if (vis.writesFeedback) makeFeedbackTarget(rt, device, width, height)
  else {
    gpu.feedbackTexture!.destroy()
    gpu.feedbackTexture = gpu.feedbackView = undefined
  }
  gpu.targetBytes += (vis.writesFeedback ? 1 : -1) * width * height * FEEDBACK_BYTES
}

/**
 * At a frame's entry: a scene that came to wear a texture, or wears none any more, asks the other
 * variant of its pipelines. It compiles aside while the set in place goes on drawing — the image
 * is the same, only the requests wait —, then is installed at the next frame's entry, which makes
 * or releases the drawn view's target (`syncFeedbackTarget`). The feedback A/B swaps its own.
 */
export function followFeedback(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { vis } = rt
  if (!rt.feedbackAB) {
    const want = wantsFeedback(rt),
      aside = vis.feedbackAside
    // A set built before the resolve came to write the emission layer is built again.
    if (aside?.feedback !== want || aside.emissiveAo !== vis.writesEmissiveAo) {
      // Replaced before it was installed: the water pass it made never drew.
      aside?.set?.water?.frame.dispose()
      vis.feedbackAside = want === vis.writesFeedback ? undefined : buildAside(rt, device, want)
    } else if (aside.set) {
      installFeedbackPipelines(rt, aside.set, want)
      vis.feedbackAside = undefined
    }
  }
  syncFeedbackTarget(rt, device)
}

/** Puts `set` in place as the variant that writes the feedback or not; the water pass it replaces
 *  lets its bindings go. */
function installFeedbackPipelines(
  rt: WebgpuPagesRuntime,
  set: FeedbackPipelines,
  feedback: boolean,
) {
  const { vis, blendState } = rt
  vis.shadeClasses = set.shadeClasses
  if (set.blendPipelines) vis.blendPipelines = set.blendPipelines
  if (set.water && set.water !== blendState.water) {
    blendState.water?.frame.dispose()
    blendState.water = set.water
  }
  vis.writesFeedback = feedback
}

function buildAside(rt: WebgpuPagesRuntime, device: GPUDevice, feedback: boolean) {
  const aside: FeedbackAside = { feedback, emissiveAo: rt.vis.writesEmissiveAo }
  feedbackPipelines(rt, device, feedback).then(
    (set) => {
      // Replaced or dropped while it compiled: never installed, its water pass lets its bindings go.
      if (rt.vis.feedbackAside !== aside) return void set.water?.frame.dispose()
      aside.set = set
      // A held image is drawn again, so the variant is installed and its requests posted.
      rt.run.gate.resourcesChanged()
    },
    (error: unknown) => rt.diag.diagnosticFailure('feedback-variant-refused', error),
  )
  return aside
}

/** The scene's pipelines in the variant `feedback`, on the layouts in place: the classes it has
 *  compiled, its blends and its water pass. */
async function feedbackPipelines(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  feedback: boolean,
): Promise<FeedbackPipelines> {
  const { vis, blendState } = rt
  const module = device.createShaderModule({
    code: feedback ? SHADE_SHADER : shadeWithoutFeedbackCode(),
  })
  const shadeMade = createWebgpuShadePipelines(
    device,
    module,
    [...vis.shadeClasses!.keys()],
    undefined,
    feedback,
    vis.shadeBindGroupLayout,
    vis.writesEmissiveAo,
    vis.shadeCache?.constants,
  )
  const blendMade =
    vis.blendPipelines &&
    createWebgpuBlendPipelines(
      device,
      blendState.blendGpu,
      undefined,
      feedback,
      vis.blendBindGroupLayout,
      blendWritesShare(rt),
      blendContext(rt),
    )
  // Neither compile reads the other: both run at once.
  const [shade, blend] = await Promise.all([shadeMade, blendMade])
  if (blend && blend.waterRefused) throw blend.waterRefused
  return {
    shadeClasses: shade.shadeClasses,
    blendPipelines: blend ? blend.blendPipelines : undefined,
    water: blend ? blend.water : undefined,
  }
}
