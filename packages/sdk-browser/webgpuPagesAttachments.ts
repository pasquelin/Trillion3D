import type { SurfaceBuffer } from './surfaceBuffer.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** Attachments of each view set the frame has drawn into, kept as long as the views live. */
const surfaceCache = new WeakMap<GPUTextureView[], GPURenderPassColorAttachment[]>();
const shadeCache = new WeakMap<GPUTextureView[], GPURenderPassColorAttachment[]>();

/**
 * Surface colour attachments, kept as-is until the next view set. Their four descriptors depend only
 * on the views, and the views change only when the target is resized: rebuilding them every image
 * allocated five objects to write the same fields. `views()` is still called every image; it is what
 * refuses a released target. Two surface buffers — the opaque resolve's and the water pass's — keep
 * their own, so a frame that writes both allocates for neither.
 */
export function surfaceColorAttachments(surfaces: SurfaceBuffer) {
  const views = surfaces.views();
  let attachments = surfaceCache.get(views);
  if (!attachments) {
    attachments = views.map((view) => ({
      view,
      loadOp: 'clear' as const,
      storeOp: 'store' as const,
      clearValue: [0, 0, 0, 0],
    }));
    surfaceCache.set(views, attachments);
  }
  return attachments;
}

const feedback: GPURenderPassColorAttachment = {
  view: undefined as unknown as GPUTextureView,
  loadOp: 'clear',
  storeOp: 'store',
};

/**
 * Attachment of the virtual-texture feedback target, and the only rule of its load: the first pass
 * of the image that writes it clears it, later ones keep it, and `feedbackWritten` tells the submit
 * there is something to reduce. Opaque resolve, blend and water surfaces all call it; none knows
 * which goes first.
 */
export function feedbackAttachment(rt: WebgpuPagesRuntime) {
  feedback.view = rt.gpu.feedbackView as GPUTextureView;
  feedback.loadOp = rt.run.feedbackWritten ? 'load' : 'clear';
  rt.run.feedbackWritten = true;
  return feedback;
}

/** Surfaces then the feedback target: the five attachments of the hardware resolve, and of the
 *  water surface stage on its own buffer. */
export function shadeColorAttachments(rt: WebgpuPagesRuntime, surfaces: SurfaceBuffer) {
  const base = surfaceColorAttachments(surfaces);
  let attachments = shadeCache.get(surfaces.views());
  if (!attachments) {
    attachments = [...base, feedback];
    shadeCache.set(surfaces.views(), attachments);
  }
  feedbackAttachment(rt);
  return attachments;
}
