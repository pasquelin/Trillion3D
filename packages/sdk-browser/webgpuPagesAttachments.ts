import type { SurfaceBuffer } from './surfaceBuffer.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

let attachmentsFor: GPUTextureView[] | undefined,
  attachments: GPURenderPassColorAttachment[] | undefined;

/**
 * Surface colour attachments, kept as-is until the next view set. Their four descriptors depend only
 * on the views, and the views change only when the target is resized: rebuilding them every image
 * allocated five objects to write the same fields. `views()` is still called every image; it is what
 * refuses a released target.
 */
export function surfaceColorAttachments(surfaces: SurfaceBuffer) {
  const views = surfaces.views();
  if (attachmentsFor !== views || !attachments) {
    attachments = views.map((view) => ({
      view,
      loadOp: 'clear' as const,
      storeOp: 'store' as const,
      clearValue: [0, 0, 0, 0],
    }));
    attachmentsFor = views;
    withFeedback = undefined;
  }
  return attachments;
}

const feedback: GPURenderPassColorAttachment = {
  view: undefined as unknown as GPUTextureView,
  loadOp: 'clear',
  storeOp: 'store',
};
let withFeedback: GPURenderPassColorAttachment[] | undefined;

/**
 * Attachment of the virtual-texture feedback target, and the only rule of its load: the first pass
 * of the image that writes it clears it, later ones keep it, and `feedbackWritten` tells the submit
 * there is something to reduce. Opaque resolve and blend both call it; neither knows which goes first.
 */
export function feedbackAttachment(rt: WebgpuPagesRuntime) {
  feedback.view = rt.gpu.feedbackView as GPUTextureView;
  feedback.loadOp = rt.run.feedbackWritten ? 'load' : 'clear';
  rt.run.feedbackWritten = true;
  return feedback;
}

/** Surfaces then the feedback target: the five attachments of the hardware resolve. */
export function shadeColorAttachments(rt: WebgpuPagesRuntime, surfaces: SurfaceBuffer) {
  const base = surfaceColorAttachments(surfaces);
  withFeedback ??= [...base, feedback];
  feedbackAttachment(rt);
  return withFeedback;
}
