import { DEFERRED_BINDINGS } from '../deferred/bindings.ts'
import { VSM_FORWARD_LAYOUT, vsmPoolLoadOf } from '../../vsm/resources.ts'

/** Where a pass binds the virtual shadow maps a consumer samples (`vsmLocate`): the page
 *  table, the projection data, the uniforms and the pool's first slice, its one window
 *  (`VSM_FORWARD_LAYOUT`). */
export interface VsmConsumerBindings {
  pageTable: number
  projectionData: number
  uniforms: number
  pool: number
}
/** The opaque resolve's and the water composite's numbers: the page table, the projection data,
 *  the uniforms and the pool. */
export const CONTRACT_VSM_BINDINGS: VsmConsumerBindings = {
  pageTable: DEFERRED_BINDINGS.pageTable,
  projectionData: DEFERRED_BINDINGS.projectionData,
  uniforms: DEFERRED_BINDINGS.uniforms,
  pool: DEFERRED_BINDINGS.pool,
}
/** The water composite's trace bindings (`vsmTraceFactor`), on the deferred numbers. */
export const CONTRACT_TRACE_BINDINGS: VsmTraceBindings = {
  view: DEFERRED_BINDINGS.shadowView,
  noise: DEFERRED_BINDINGS.shadowNoise,
}
/** The bindings as a block name reads them, in their declared order. */
export const vsmBindingsLabel = (b: VsmConsumerBindings) =>
  `${b.pageTable}, ${b.projectionData}, ${b.uniforms}, ${b.pool}`

/** Where a blend or water pass binds what its fragments trace with past the maps: the projection's
 *  view uniform (`VsmProjectionView`) and its blue noise. Their screen ray marches the depth pyramid
 *  their reflection group holds (`REFLECTION_GROUP`): the very pyramid the projection marches. */
export interface VsmTraceBindings {
  view: number
  noise: number
}
export const vsmTraceBindingsLabel = (t: VsmTraceBindings) => `${t.view} ${t.noise}`

/** The pool's first slice at `binding`, read as the VSM passes read it (`vsmPoolLoadOf`): the same
 *  windows and words, compiled for the largest pool the engine grants (`VSM_FORWARD_LAYOUT`). */
export const forwardPool = (binding: number) =>
  vsmPoolLoadOf(0, [{ resource: 'pagePool', binding, slices: 1 }], VSM_FORWARD_LAYOUT)

/** Shadow bindings past the virtual shadow maps' own (`CONTRACT_VSM_BINDINGS`), on the numbers the
 *  water composite reads them at too: the opaque resolve's mask — a forward pass's transmission
 *  (`directShadowWgsl`). */
export const CONTRACT_SHADOW_BINDINGS = {
  transmittance: DEFERRED_BINDINGS.transmittance,
}
