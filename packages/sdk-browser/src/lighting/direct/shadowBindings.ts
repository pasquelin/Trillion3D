import { DEFERRED_BINDINGS } from '../deferred/bindings.ts'
import { VSM_FORWARD_LAYOUT, vsmPoolLoadOf } from '../shadows/vsm/resources.ts'

/** Where a blend pass binds the virtual shadow maps its fragments' trace samples: the page table,
 *  the projection data, the uniforms and the pool's first slice, one buffer
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
  /** The blue noise is a read-only storage texture, read by load, not a sampled texture
   *  (`blueNoiseWgsl`). */
  loadOnly?: boolean
}
export const vsmTraceBindingsLabel = (t: VsmTraceBindings) =>
  `${t.view} ${t.noise} ${!!t.subgroups} ${!!t.loadOnly}`

/** The pool's first slice at `binding` of group `group`, read as the VSM passes read it
 *  (`vsmPoolLoadOf`): the same words, compiled for the layout every pool shares
 *  (`VSM_FORWARD_LAYOUT`). */
export const forwardPool = (binding: number, group = 0) =>
  vsmPoolLoadOf(group, [{ resource: 'pagePool', binding, slices: 1 }], VSM_FORWARD_LAYOUT)

/** Where the opaque lit passes bind what the local lights' mask is read with: the shadowed lights' grid a
 *  light's lane is found in (`vsmMaskLaneOf`), and the maps a light with no lane is read from
 *  (`vsmSampleMapLocal`): the shadow data and the projection's view (`DEFERRED_BINDINGS`). */
export interface VsmMaskReadBindings {
  lightGrid: number
  vsm: VsmConsumerBindings
  view: number
}

/** The opaque lit passes' shadow bindings: the local lights' mask and the suns' (`directShadowWgsl`), and
 *  the maps the lights past the mask's lanes are read from (`DEFERRED_BINDINGS`). The projection traced
 *  the lights the masks hold. */
export const CONTRACT_SHADOW_BINDINGS = {
  vsmMask: DEFERRED_BINDINGS.vsmMask,
  vsmSunMask: DEFERRED_BINDINGS.vsmSunMask,
  fallback: {
    lightGrid: DEFERRED_BINDINGS.vsmLightGrid,
    vsm: {
      pageTable: DEFERRED_BINDINGS.vsmPageTable,
      projectionData: DEFERRED_BINDINGS.vsmProjectionData,
      uniforms: DEFERRED_BINDINGS.vsmUniforms,
      pool: DEFERRED_BINDINGS.vsmPool,
    },
    view: DEFERRED_BINDINGS.vsmView,
  } satisfies VsmMaskReadBindings,
}
