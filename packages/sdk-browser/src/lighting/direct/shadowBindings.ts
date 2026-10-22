import { DEFERRED_BINDINGS } from '../deferred/bindings.ts'
import { VSM_FORWARD_LAYOUT, vsmPoolLoadOf } from '../shadows/vsm/resources.ts'

/** Where a blend pass binds the virtual shadow maps its fragments' trace samples: the page table,
 *  the projection data, the uniforms and the pool's first slice, its one window
 *  (`VSM_FORWARD_LAYOUT`). */
export interface VsmConsumerBindings {
  pageTable: number
  projectionData: number
  uniforms: number
  pool: number
}
/** The bindings as a block name reads them, in their declared order. */
export const vsmBindingsLabel = (b: VsmConsumerBindings) =>
  `${b.pageTable}, ${b.projectionData}, ${b.uniforms}, ${b.pool}`

/** Where a blend pass binds what its fragments trace with past the maps: the projection's
 *  view uniform (`VsmProjectionView`) and its blue noise. Their screen ray marches the depth pyramid
 *  their reflection group holds (`REFLECTION_GROUP`): the very pyramid the projection marches. */
export interface VsmTraceBindings {
  view: number
  noise: number
  /** The device grants subgroups: a local light's rays vote over the fragment's subgroup
   *  (`vsmLoneVoteWgsl`). */
  subgroups?: boolean
  /** The blue noise and the translucent casters' memory are read-only storage textures, read by
   *  load, not sampled textures (`vsmBlueNoiseWgsl`, `vsmTransmissionReadWgsl`). */
  loadOnly?: boolean
}
export const vsmTraceBindingsLabel = (t: VsmTraceBindings) =>
  `${t.view} ${t.noise} ${!!t.subgroups} ${!!t.loadOnly}`

/** The pool's first slice at `binding` of group `group`, read as the VSM passes read it
 *  (`vsmPoolLoadOf`): the same windows and words, compiled for the largest pool the engine grants
 *  (`VSM_FORWARD_LAYOUT`). */
export const forwardPool = (binding: number, group = 0) =>
  vsmPoolLoadOf(group, [{ resource: 'pagePool', binding, slices: 1 }], VSM_FORWARD_LAYOUT)

/** The opaque resolve's shadow binding: the mask (`directShadowWgsl`), its transmission and tile
 *  words beside it (`DEFERRED_BINDINGS`). It reads no map: the projection traced them. */
export const CONTRACT_SHADOW_BINDINGS = {
  transmittance: DEFERRED_BINDINGS.transmittance,
}
