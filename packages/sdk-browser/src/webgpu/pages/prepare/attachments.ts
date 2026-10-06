import type { SurfaceBuffer } from '../../../scene/surfaceBuffer.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'

type Attachments = Array<GPURenderPassColorAttachment | null>

let attachmentsFor: GPUTextureView[] | undefined, attachments: Attachments | undefined

/** Each surface view as `attach` makes it; the emission-and-occlusion slot empty while the layer is
 *  its 1×1 stand-in (`SurfaceBuffer.hasEmissiveAo`): its pipelines write no target there. */
const surfaceSlots = (
  surfaces: SurfaceBuffer,
  views: GPUTextureView[],
  attach: (view: GPUTextureView) => GPURenderPassColorAttachment,
): Attachments =>
  views.map((view, at) => (at === 2 && surfaces.hasEmissiveAo === false ? null : attach(view)))

/**
 * Surface colour attachments, kept as-is until the next view set. Their four descriptors depend only
 * on the views, and the views change only when the target is resized: rebuilding them every image
 * allocated five objects to write the same fields. `views()` is still called every image; it is what
 * refuses a released target.
 */
export function surfaceColorAttachments(surfaces: SurfaceBuffer) {
  const views = surfaces.views()
  if (attachmentsFor !== views || !attachments) {
    attachments = surfaceSlots(surfaces, views, (view) => ({
      view,
      loadOp: 'clear' as const,
      storeOp: 'store' as const,
      clearValue: [0, 0, 0, 0],
    }))
    attachmentsFor = views
    withFeedback = undefined
  }
  return attachments
}

let loadedFor: GPUTextureView[] | undefined, loaded: Attachments | undefined

/** The same surfaces, kept rather than cleared: a pass drawing over what the material passes wrote
 *  (the impostor cards, `../../impostor/encode.ts`). Rebuilt only with the view set. */
export function surfaceLoadAttachments(surfaces: SurfaceBuffer) {
  const views = surfaces.views()
  if (loadedFor !== views || !loaded) {
    loaded = surfaceSlots(surfaces, views, (view) => ({
      view,
      loadOp: 'load' as const,
      storeOp: 'store' as const,
    }))
    loadedFor = views
  }
  return loaded
}

const feedback: GPURenderPassColorAttachment = {
  view: undefined as unknown as GPUTextureView,
  loadOp: 'clear',
  storeOp: 'store',
}
let withFeedback: Attachments | undefined

/**
 * Attachment of the virtual-texture feedback target, and the only rule of its load: the first pass
 * of the image that writes it clears it, later ones keep it, and `feedbackWritten` tells the submit
 * there is something to reduce. Opaque resolve, blend and water surfaces all call it; none knows
 * which goes first.
 */
export function feedbackAttachment(rt: WebgpuPagesRuntime) {
  feedback.view = rt.gpu.feedbackView as GPUTextureView
  feedback.loadOp = rt.run.feedbackWritten ? 'load' : 'clear'
  rt.run.feedbackWritten = true
  return feedback
}

/** Surfaces then the feedback target, while the pipelines write it (`feedbackVariant.ts`): the
 *  attachments of the hardware resolve. */
export function shadeColorAttachments(rt: WebgpuPagesRuntime, surfaces: SurfaceBuffer) {
  const base = surfaceColorAttachments(surfaces)
  if (!rt.vis.writesFeedback) return base
  withFeedback ??= [...base, feedback]
  feedbackAttachment(rt)
  return withFeedback
}
