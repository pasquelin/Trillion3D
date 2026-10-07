// Batch F oracle, frame side: `packages/sdk-browser/src/webgpu/pages/render/encodeVis.ts:93-98`
// from before batch F, copied as-is.
import type { SurfaceBuffer } from '../../../packages/sdk-browser/src/scene/surfaceBuffer.ts'

/** Colour attachments, rebuilt per frame before batch F. */
export function referenceAttachments(surfaces: SurfaceBuffer) {
  return surfaces.views().map((view) => ({
    view,
    loadOp: 'clear' as const,
    storeOp: 'store' as const,
    clearValue: [0, 0, 0, 0],
  }))
}
