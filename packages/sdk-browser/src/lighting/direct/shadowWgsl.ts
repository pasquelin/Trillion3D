import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import {
  vsmBindingsLabel,
  vsmTraceBindingsLabel,
  type VsmConsumerBindings,
  type VsmTraceBindings,
} from './shadowBindings.ts'
import { vsmConsumerWgsl } from './vsmConsumerWgsl.ts'
import { BLEND_TRACE_BINDINGS, BLEND_VSM_BINDINGS } from '../../webgpu/core/bindLayout.ts'
import {
  VSM_NO_PIXEL_WGSL,
  vsmFragmentSampleWgsl,
  vsmFragmentTraceWgsl,
  vsmMaskWgsl,
} from './shadowTraceWgsl.ts'
import { LIGHT_SETTINGS } from '../../../../sdk-core/src/scene/light/contracts.ts'
import { VSM_BIAS_NORMAL_WGSL } from '../../vsm/receiverTraceWgsl.ts'
import { VSM_TRACE_KINDS_BOTH, VSM_TRACE_KINDS_SUN } from '../../vsm/traceWgsl.ts'

/**
 * The shadow read of every lit surface, through the virtual shadow maps (`../../vsm/`): one
 * estimator, the receiver's trace (`vsmReceiverTraceWgsl`). A shadowed light's `params.y` is
 * `firstVsmId · 64 + channel`, −1 without a shadow (`vsmEncode.ts`), its channel the light's rank in
 * the frame's projection (`vsmView.lights`). The opaque resolve reads the trace the projection pass
 * stored in the frame's mask (`encodeVirtualShadowProjection`) at its own pixel (`vsmMaskPixel`,
 * set by its shadow setup), and what the translucent casters let through along the same rays from
 * the mask's transmission (`vsmMaskThrough`). A translucent surface, which no mask holds, reads its
 * own fragment on the same view and maps, lit forward: by default one sample of the light's map
 * (`vsmSampleFactor`), its local lights unshadowed (`LIGHT_SETTINGS.translucentShadowQuality`,
 * `translucentLocalShadows`); at quality 1 the projection's full trace (`vsmTraceFactor`), its rays
 * multiplying the panes they cross as the projection's do.
 *
 * The resolve reads a shadow only in a cell its shadow setup set the mask pixel of
 * (`cellShadowed`, `shadowSetup`): a cell whose list holds a light with a shadow slot, or — no room
 * for its list — that walks every light, where a light of no list of the cell gives its points
 * exactly zero before any shadow read (`declaredLight`, `incidence.w`), as the lists rest on.
 *
 * `pass` names the read: `'mask'` for the opaque resolve, with `resolveTransmission` the binding of
 * the mask's transmission (`DEFERRED_BINDINGS.transmissionResolve`); `'blend'` (the default) for a
 * blend pass, which samples or traces its fragment (`quality`). `maskBinding` is the mask array, and in a blend pass, which
 * declares no mask, the translucent casters' memory its rays read. `trace`, the bindings a blend
 * pass traces with (`BLEND_TRACE_BINDINGS` unless given). The names the passes write (receiver
 * offset and plane, eye) are kept, so their bodies need no change. The block lists what it calls,
 * the maths library's declarations included.
 */
export const directShadowWgsl = (maskBinding: number, options: DirectShadowOptions = {}) => {
  if (options.pass !== 'mask') {
    const {
      vsm = BLEND_VSM_BINDINGS,
      trace = BLEND_TRACE_BINDINGS,
      quality = LIGHT_SETTINGS.translucentShadowQuality,
      localShadows = LIGHT_SETTINGS.translucentLocalShadows,
    } = options
    // Without local shadows (`translucentLocalShadows` off), the sun's code alone is compiled, and
    // a shadowed local light is lit whole before any read; a program of no sun reads none.
    const kinds =
      (options.kinds ?? VSM_TRACE_KINDS_BOTH) &
      (localShadows ? VSM_TRACE_KINDS_BOTH : VSM_TRACE_KINDS_SUN)
    const label = `directShadowWgsl(${maskBinding}, ${vsmBindingsLabel(vsm)}, ${vsmTraceBindingsLabel(trace)}, ${kinds}, ${quality}, ${localShadows})`
    if (!kinds) {
      const unshadowed = shadowFactorWgsl('\n return 1.0;')
      return wgslBlock(label, [VSM_NO_PIXEL_WGSL, VSM_BIAS_NORMAL_WGSL], unshadowed)
    }
    const local = localShadows
      ? ''
      : `
 if(vsmView.lights[channel].kind!=LIGHT_KIND_DIRECTIONAL){return 1.0;}`
    return wgslBlock(
      label,
      [
        vsmConsumerWgsl(vsm),
        quality === 0
          ? vsmFragmentSampleWgsl(vsm.pool, trace.view, kinds)
          : vsmFragmentTraceWgsl(vsm.pool, trace, maskBinding, kinds),
      ],
      shadowFactorWgsl(`
 let channel=u32(slice)&63u;${local}
 return ${quality === 0 ? 'vsmSampleFactor(channel,P)' : 'vsmTraceFactor(channel,P,N)'};`),
    )
  }
  const through = options.resolveTransmission
  return wgslBlock(
    `directShadowWgsl(${maskBinding}, ${through})`,
    [vsmMaskWgsl(maskBinding, through), VSM_BIAS_NORMAL_WGSL],
    shadowFactorWgsl(`
 let channel=u32(slice)&63u;
 let mask=vsmMaskFactor(channel);
 if(mask>0.0){shadowTransmission=vsmMaskThrough(channel);}
 return mask;`),
  )
}

/** The names every pass's shadow read writes, and \`shadowFactor\` reading a shadowed light's share
 *  through \`read\`. */
const shadowFactorWgsl = (read: string) => `
var<private> shadowReceiverOffset:vec3f=vec3f(0.0);
var<private> shadowReceiverPlane:vec3f=vec3f(0.0);
var<private> shadowTransmission:vec3f=vec3f(1.0);
fn shadowFactor(slice:i32,light:DirectLight,P:vec3f,N:vec3f,facing:bool)->f32{
 shadowTransmission=vec3f(1.0);
 if(slice<0){return 1.0;}
 if(!facing){return 0.0;}${read}
}`

/** What a shadow read takes past its mask's binding (`directShadowWgsl`): the pass kind — a mask
 *  read with the binding of the mask's transmission beside it, or a blend pass's trace with the
 *  virtual shadow maps' bindings, its trace bindings and the kinds it traces. */
type DirectShadowOptions =
  | {
      pass?: 'blend'
      vsm?: VsmConsumerBindings
      trace?: VsmTraceBindings
      /** The light kinds the fragments trace (`vsmTraceKindsOf`), both unless given. */
      kinds?: number
      /** One sample (0) or the full trace (1): `LIGHT_SETTINGS.translucentShadowQuality` unless given. */
      quality?: 0 | 1
      /** Whether local lights shadow: `LIGHT_SETTINGS.translucentLocalShadows` unless given. */
      localShadows?: boolean
    }
  | { pass: 'mask'; resolveTransmission: number }
