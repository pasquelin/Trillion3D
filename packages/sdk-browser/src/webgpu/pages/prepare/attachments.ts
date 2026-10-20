import type { SurfaceBuffer } from '../../../scene/surfaceBuffer.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'

type Attachments = Array<GPURenderPassColorAttachment | null>

/** Each surface view as `attach` makes it; the emission-and-occlusion slot empty while the layer is
 *  its 1×1 stand-in (`SurfaceBuffer.hasEmissiveAo`): its pipelines write no target there. */
const surfaceSlots = (
  surfaces: SurfaceBuffer,
  views: GPUTextureView[],
  attach: (view: GPUTextureView) => GPURenderPassColorAttachment,
): Attachments =>
  views.map((view, at) => (at === 2 && surfaces.hasEmissiveAo === false ? null : attach(view)))

/** Surface attachments as `attach` makes them, kept as-is per view set: their descriptors depend
 *  only on the views, and the views change only when a target is resized — each view drawn in turn
 *  (`world.addView`) keeps its own. `views()` is still called every image; it is what refuses a
 *  released target. `withFeedback` adds the feedback target after them while the pipelines write
 *  it (`feedbackVariant.ts`). */
function attachmentMemo(attach: (view: GPUTextureView) => GPURenderPassColorAttachment) {
  const made = new WeakMap<GPUTextureView[], { base: Attachments; withFeedback?: Attachments }>()
  const entry = (surfaces: SurfaceBuffer) => {
    const views = surfaces.views()
    let held = made.get(views)
    if (!held) made.set(views, (held = { base: surfaceSlots(surfaces, views, attach) }))
    return held
  }
  return {
    of: (surfaces: SurfaceBuffer) => entry(surfaces).base,
    withFeedback(rt: WebgpuPagesRuntime, surfaces: SurfaceBuffer) {
      const held = entry(surfaces)
      if (!rt.vis.writesFeedback) return held.base
      held.withFeedback ??= [...held.base, feedback]
      feedbackAttachment(rt)
      return held.withFeedback
    },
  }
}

const feedback: GPURenderPassColorAttachment = {
  view: undefined as unknown as GPUTextureView,
  loadOp: 'clear',
  storeOp: 'store',
}

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

/** The surfaces cleared: rebuilding them every image allocated five objects to write the same
 *  fields. */
const cleared = attachmentMemo((view) => ({
  view,
  loadOp: 'clear' as const,
  storeOp: 'store' as const,
  clearValue: [0, 0, 0, 0],
}))

/** Surface colour attachments, cleared. */
export const surfaceColorAttachments = cleared.of

/** Surfaces cleared, then the feedback target: the attachments of the hardware resolve. */
export const shadeColorAttachments = cleared.withFeedback
