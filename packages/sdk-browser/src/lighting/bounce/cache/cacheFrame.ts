import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'

/** The update of the radiance cache the image queued and the screen probes made none of — they cast nothing, or were not
 *  ready — made now, in a pass of its own, after them and before the lighting (`traceScreenProbes`). */
export function flushRadianceCache(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder) {
  rt.bounce.probes?.cache.flush(encoder)
}
