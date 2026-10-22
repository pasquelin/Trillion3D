// What the lighting and the other shadow reads take from this frame's shadow maps, or nothing.
import type { WebgpuPagesRuntime } from '../../../../frame/backend/runtime.ts'
import type { DeferredPlaceholders } from '../../../deferred/setup.ts'
import { vsmProjectionShared } from '../projection/projectionStore.ts'

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

/** This frame's resources a non-mask read takes (the translucent layers): the maps, the pool's first slice —
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

const standIns = {} as typeof consumer

/** What a pass that reads the maps whether or not this frame projects some binds: the resources
 *  `vsm` holds (`vsmConsumerResources`), each its stand-in where there are none. One object,
 *  rewritten at each call. */
export function vsmOrStandIns(
  vsm: ReturnType<typeof vsmConsumerResources>,
  placeholders: DeferredPlaceholders,
) {
  standIns.pageTable = vsm?.pageTable ?? placeholders.vsmPageTable
  standIns.projectionData = vsm?.projectionData ?? placeholders.vsmProjectionData
  standIns.uniforms = vsm?.uniforms ?? placeholders.vsmUniforms
  standIns.pool = vsm?.pool ?? placeholders.vsmPool
  standIns.view = vsm?.view ?? placeholders.vsmProjectionView
  standIns.noise = vsm?.noise ?? placeholders.vsmBlueNoise
  return standIns
}

/** The transmission atlas the shadow reads multiply by, or none. */
export const vsmTransmissionView = (rt: WebgpuPagesRuntime) => projectedVsm(rt)?.transmission?.view

/** The mask's transmission the lighting pass reads (`vsmMaskThrough`), or none this frame. */
export const vsmShadowThrough = (rt: WebgpuPagesRuntime) => projectedVsm(rt)?.mask?.throughView
/** The mask the lighting pass reads, or none this frame. */
export const vsmShadowMask = (rt: WebgpuPagesRuntime) => projectedVsm(rt)?.mask?.view
/** The mask's tile words the lighting pass reads with it (`vsmMaskFactor`), or none this frame. */
export const vsmShadowMaskTiles = (rt: WebgpuPagesRuntime) => projectedVsm(rt)?.mask?.tilesView
