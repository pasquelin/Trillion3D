// What the lighting and the other shadow reads take from this frame's shadow maps, or nothing.
import type { WebgpuPagesRuntime } from '../../runtime.ts'

const consumer = {} as {
  pageTable: GPUBuffer
  projectionData: GPUBuffer
  uniforms: GPUBuffer
  pool: GPUBuffer
}

/** The engine's maps when this frame projects some, else none. */
function projectedVsm(rt: WebgpuPagesRuntime) {
  const vsm = rt.lights.vsm
  return vsm?.plan && vsm.plan.projectionCount > 0 ? vsm : undefined
}

/** This frame's buffers a non-mask read samples (blend, water, reflections), or none: the pool
 *  must be one binding (the device's binding limit holds a whole slice). */
export function vsmConsumerResources(rt: WebgpuPagesRuntime) {
  const vsm = projectedVsm(rt)
  if (!vsm || vsm.res.layout.poolPartsPerSlice !== 1) return undefined
  consumer.pageTable = vsm.res.current.pageTable
  consumer.projectionData = vsm.res.current.projectionData
  consumer.uniforms = vsm.res.current.uniforms
  consumer.pool = vsm.res.pagePool[0][0]
  return consumer
}

/** The transmission atlas the shadow reads multiply by, or none. */
export const vsmTransmissionView = (rt: WebgpuPagesRuntime) => projectedVsm(rt)?.transmission?.view

/** The mask the lighting pass reads, or none this frame. */
export const vsmShadowMask = (rt: WebgpuPagesRuntime) => projectedVsm(rt)?.mask?.view
/** The mask's tile words the lighting pass reads with it (`vsmMaskFactor`), or none this frame. */
export const vsmShadowMaskTiles = (rt: WebgpuPagesRuntime) => projectedVsm(rt)?.mask?.tilesView
