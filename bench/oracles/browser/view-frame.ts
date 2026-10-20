// Batch F oracle, frame side: `packages/sdk-browser/src/frame/render/encodeVis.ts:93-98`
// from before batch F, copied as-is.
import type { SurfaceBuffer } from '../../../packages/sdk-browser/src/materials/surface/surfaceBuffer.ts'

/** Colour attachments, rebuilt per frame before batch F. */
export function referenceAttachments(surfaces: SurfaceBuffer) {
  return surfaces.views().map((view) => ({
    view,
    loadOp: 'clear' as const,
    storeOp: 'store' as const,
    clearValue: [0, 0, 0, 0],
  }))
}
