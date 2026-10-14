import { SHADOW_VIEW_WGSL } from './shadowViewWgsl.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { ALL_SHADOW_KINDS, shadowKindsLabel, type ShadowKinds } from './shadowKinds.ts'
import {
  CONTRACT_TRACE_BINDINGS,
  CONTRACT_VSM_BINDINGS,
  vsmBindingsLabel,
  vsmTraceBindingsLabel,
  type VsmConsumerBindings,
  type VsmTraceBindings,
} from './shadowBindings.ts'
import { vsmConsumerWgsl } from './vsmConsumerWgsl.ts'
import { VSM_TRANSMISSION_AT_WGSL, vsmFragmentTraceWgsl, vsmMaskWgsl } from './shadowTraceWgsl.ts'

/**
 * The shadow read of every lit surface, through the virtual shadow maps (`../../vsm/`): one
 * estimator, the receiver's trace (`vsmReceiverTraceWgsl`). A shadowed light's `params.y` is
 * `firstVsmId · 64 + channel`, −1 without a shadow (`vsmEncode.ts`), its channel the light's rank in
 * the frame's projection (`vsmView.lights`). The opaque resolve reads the trace the projection pass
 * stored in the frame's mask (`encodeVirtualShadowProjection`) at its own pixel (`vsmMaskPixel`,
 * set by its shadow setup). A blended surface and the water, which the mask cannot hold, trace
 * their own fragment (`vsmTraceFactor`) on the same view, noise and maps. Every pass then reads the
 * located sample (`vsmTransmissionRead`) for the translucent casters' transmission alone.
 *
 * The resolve reads a shadow only in a cell its shadow setup set the mask pixel of
 * (`cellShadowed`, `shadowSetup`): a cell whose list holds a light with a shadow slot, or — no room
 * for its list — that walks every light, where a light of no list of the cell gives its points
 * exactly zero before any shadow read (`declaredLight`, `incidence.w`), as the lists rest on.
 *
 * `resolveTransmission` is the opaque resolve's binding of the translucent casters' transmission
 * (`DEFERRED_BINDINGS.transmissionResolve`), null in a blend or water pass; `maskBinding` the resolve's
 * mask array, and in the other passes, which declare no mask, their transmission. `trace`, the
 * bindings a blend or water pass traces with (the water's, `CONTRACT_TRACE_BINDINGS`, unless given). The names the passes write (footprint, receiver
 * offset and plane, view) are kept, so their bodies need no change. The block lists what it calls,
 * the maths library's declarations included.
 */
export const directShadowWgsl = (
  maskBinding: number,
  {
    resolveTransmission = null,
    vsm = CONTRACT_VSM_BINDINGS,
    kinds = ALL_SHADOW_KINDS,
    trace = CONTRACT_TRACE_BINDINGS,
  }: DirectShadowOptions = {},
) => {
  const label = `directShadowWgsl(${maskBinding}, ${resolveTransmission}, ${vsmBindingsLabel(vsm)}, ${shadowKindsLabel(kinds)}, ${vsmTraceBindingsLabel(trace)})`
  if (resolveTransmission === null)
    return wgslBlock(
      label,
      [
        SHADOW_VIEW_WGSL,
        vsmConsumerWgsl(vsm, { transmission: maskBinding, pool: true, kinds }),
        VSM_TRANSMISSION_AT_WGSL,
        vsmFragmentTraceWgsl(vsm, trace),
      ],
      shadowFactorWgsl(`
 let factor=vsmTraceFactor(u32(slice)&63u,P,N);
 if(factor>0.0&&vsmTranslucentCasters()){vsmTransmissionRead(u32(slice)>>6u,isSun(light),P,N);}
 return factor;`),
    )
  return wgslBlock(
    label,
    [
      SHADOW_VIEW_WGSL,
      vsmConsumerWgsl(vsm, { transmission: resolveTransmission, pool: false, kinds }),
      VSM_TRANSMISSION_AT_WGSL,
      vsmMaskWgsl(maskBinding),
    ],
    shadowFactorWgsl(`
 let mask=vsmMaskFactor(u32(slice)&63u);
 // The traced mask is opaque only: the translucent casters' colour from the page-table lookup.
 if(mask>0.0&&vsmTranslucentCasters()){vsmTransmissionRead(u32(slice)>>6u,isSun(light),P,N);}
 return mask;`),
  )
}

/** The names every pass's shadow read writes, and \`shadowFactor\` reading a shadowed light's share
 *  through \`read\`. */
const shadowFactorWgsl = (read: string) => `
var<private> shadowFootprint:f32=0.0;
var<private> shadowReceiverOffset:vec3f=vec3f(0.0);
var<private> shadowReceiverPlane:vec3f=vec3f(0.0);
var<private> shadowTransmission:vec3f=vec3f(1.0);
fn shadowBiasNormal(n:vec3f,g:vec3f)->vec3f{
 if(dot(g,g)==0.0){return n;}
 return select(g,-g,dot(g,n)<0.0);
}
fn shadowFactor(slice:i32,light:DirectLight,P:vec3f,N:vec3f,facing:bool)->f32{
 shadowTransmission=vec3f(1.0);
 if(slice<0){return 1.0;}
 if(!facing){return 0.0;}${read}
}`

/** What a shadow read takes past its mask's binding (`directShadowWgsl`): the opaque resolve's
 *  binding of the translucent casters' transmission (none in a blend or water pass), the virtual
 *  shadow maps' bindings, the light kinds read, and a blend or water pass's trace bindings. */
export type DirectShadowOptions = {
  resolveTransmission?: number | null
  vsm?: VsmConsumerBindings
  kinds?: ShadowKinds
  trace?: VsmTraceBindings
}
