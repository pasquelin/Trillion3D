// What the lighting and the other shadow reads take from this frame's shadow maps, or nothing.
import type { WebgpuPagesRuntime } from '../../runtime.ts'
import { vsmProjectionShared } from '../../../../vsm/projectionPass.ts'

const consumer = {} as {
  pageTable: GPUBuffer
  projectionData: GPUBuffer
  uniforms: GPUBuffer
  pool: GPUBuffer
  view: GPUBuffer
  noise: GPUTextureView
}

/** The engine's maps when this frame projects some, else none. */
function projectedVsm(rt: WebgpuPagesRuntime) {
  const vsm = rt.lights.vsm
  return vsm?.plan && vsm.plan.projectionCount > 0 ? vsm : undefined
}

/** This frame's resources a non-mask read takes (blend, water): the maps, the pool's first slice —
 *  its one window (`VSM_FORWARD_LAYOUT`) — and the projection's view and noise its fragments trace
 *  with (`vsmTraceFactor`), or none. */
export function vsmConsumerResources(rt: WebgpuPagesRuntime) {
  const vsm = projectedVsm(rt)
  const shared = vsm && vsmProjectionShared(vsm.res)
  if (!vsm || !shared) return undefined
  consumer.pageTable = vsm.res.current.pageTable
  consumer.projectionData = vsm.res.current.projectionData
  consumer.uniforms = vsm.res.current.uniforms
  consumer.pool = vsm.res.pagePool[0][0]
  consumer.view = shared.view
  consumer.noise = shared.noise
  return consumer
}

/** The transmission atlas the shadow reads multiply by, or none. */
export const vsmTransmissionView = (rt: WebgpuPagesRuntime) => projectedVsm(rt)?.transmission?.view

/** The mask the lighting pass reads, or none this frame. */
export const vsmShadowMask = (rt: WebgpuPagesRuntime) => projectedVsm(rt)?.mask?.view
/** The mask's tile words the lighting pass reads with it (`vsmMaskFactor`), or none this frame. */
export const vsmShadowMaskTiles = (rt: WebgpuPagesRuntime) => projectedVsm(rt)?.mask?.tilesView
