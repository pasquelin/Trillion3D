import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import {
  forwardPool,
  vsmBindingsLabel,
  vsmTraceBindingsLabel,
  type VsmConsumerBindings,
  type VsmMaskReadBindings,
  type VsmTraceBindings,
} from './shadowBindings.ts'
import { vsmConsumerWgsl } from './vsmConsumerWgsl.ts'
import { BLEND_TRACE_BINDINGS, BLEND_VSM_BINDINGS } from '../../gpu/bind/bindLayout.ts'
import {
  VSM_NO_PIXEL_WGSL,
  vsmFragmentSampleWgsl,
  vsmFragmentTraceWgsl,
  vsmMaskWgsl,
  vsmTraceViewWgsl,
} from './shadowTraceWgsl.ts'
import { SHADOW_SLICE_WGSL } from './shadowSlice.ts'
import { vsmSampleMapLocalWgsl } from '../shadows/vsm/sampleMapWgsl.ts'
import { beerShadowReadWgsl } from '../heterogeneousVolumes/beerShadowReadWgsl.ts'
import { SHADOW_RULES } from '../../../../sdk-core/src/contracts/shadowOptions.ts'
import { VSM_TRACE_KINDS_BOTH, VSM_TRACE_KINDS_SUN } from '../shadows/vsm/trace/traceWgsl.ts'
import {
  TRANSLUCENT_SHADOW_FLAG_SHIFT,
  TRANSLUCENT_SHADOW_MARK,
} from '../../materials/surface/surfaceModelWord.ts'

/**
 * The shadow read of every lit surface, through the virtual shadow maps (`../shadows/vsm/`): one
 * estimator, the receiver's trace (`vsmReceiverTraceWgsl`). A shadowed light's `params.y` is the rank of
 * its record in the frame's projection (`vsmView.lights`) and two flags (`shadowSliceOf`), −1 without a
 * shadow (`vsmEncode.ts`). The opaque lit passes read the trace the projection passes stored in the
 * frame's masks (`encodeVirtualShadowProjection`) at their own pixel (`vsmMaskPixel`, set by
 * `vsmMaskAt`): a sun its layer of the suns' mask, a local light its lane of the pixel's mask, or,
 * past the lanes the mask keeps, one sample of its own map (`vsmSampleMapLocal`), as the reference reads a
 * light its pixel's mask has no lane for. A translucent surface, which no mask holds, reads its own fragment on
 * the same view and maps, lit forward: by default one sample of the light's map
 * (`vsmSampleFactor`), its local lights unshadowed (the project switches
 * `shadowTranslucentQuality` and `shadowTranslucentLocalLights`, `TranslucentShadow`); at quality 1
 * the projection's full trace (`vsmTraceFactor`). A surface asks for more of its own — its local
 * lights' shadow, a trace of the local lights' or the sun's — by the marks its item's flags carry
 * (`translucentShadowBits`, `TRANSLUCENT_SHADOW_MARK`), the program holding the code of what any
 * surface of its scene asks (`TranslucentMaterialShadow`).
 *
 * A lit pass reads a shadow only for a light that has a shadow slot, and a light of no list of the
 * cell gives its points exactly zero before any shadow read (`declaredLight`, `lamp.falloff`), as the
 * lists rest on.
 *
 * `pass` names the read: `'mask'` for the opaque lit passes, with `sun` the binding of the suns' mask,
 * `local` that of the local lights' mask where the pass walks local lights, and, if given, `farMask` that of the sun's distance-field shadow
 * (`DEFERRED_BINDINGS.farShadowMask`); `'blend'` (the default) for a blend pass, which samples
 * (`quality` 0) or traces (`quality` past 0) its fragment, its local lights shadowed only with
 * `localShadows`. `trace`, the bindings a blend pass traces with (`BLEND_TRACE_BINDINGS` unless
 * given). The block lists what it calls, the maths library's declarations included.
 */
export const directShadowWgsl = (options: DirectShadowOptions = {}) =>
  options.pass === 'mask'
    ? maskShadowWgsl(options)
    : options.pass === 'perLight'
      ? perLightShadowWgsl(options)
      : blendShadowWgsl(options)

/** The body of a blend pass's `shadowFactor` where some kind is read: the kinds differ in how they are
 *  read, or in whether a surface may be shadowed by them, and a light of a kind no surface reads the
 *  shadow of is lit whole. `sun` and `local` are the expressions of the fragment that say whether
 *  each kind is traced. */
const blendReadWgsl = (sun: string, local: string, localAny: boolean, localShadows: boolean) => {
  const differ = localAny && sun !== local
  const directional =
    differ || (localAny && !localShadows)
      ? `
 let directional=vsmView.lights[channel].kind==LIGHT_KIND_DIRECTIONAL;`
      : ''
  const gate = !localAny
    ? `
 if(vsmView.lights[channel].kind!=LIGHT_KIND_DIRECTIONAL){return 1.0;}`
    : localShadows
      ? ''
      : `
 if(!directional&&(translucentShadowBits&${TRANSLUCENT_SHADOW_MARK.local}u)==0u){return 1.0;}`
  const traced = differ ? `select(${local},${sun},directional)` : sun
  const read =
    traced === 'true'
      ? '\n return vsmTraceFactor(channel,P,N);'
      : traced === 'false'
        ? '\n return vsmSampleFactor(channel,P);'
        : `\n if(${traced}){return vsmTraceFactor(channel,P,N);}\n return vsmSampleFactor(channel,P);`
  return `\n let channel=shadowSliceRecord(slice);${directional}${gate}\n if(shadowSkipSun&&vsmView.lights[channel].kind==LIGHT_KIND_DIRECTIONAL){return 1.0;}${read}`
}

/** The shadow read of a blend pass: one sample or the trace of its fragment. */
const blendShadowWgsl = (options: BlendShadowOptions) => {
  const {
    vsm = BLEND_VSM_BINDINGS,
    trace = BLEND_TRACE_BINDINGS,
    quality = TRANSLUCENT_SHADOW_DEFAULT.quality,
    localShadows = TRANSLUCENT_SHADOW_DEFAULT.localShadows,
    classic = false,
    materials = NO_TRANSLUCENT_MATERIAL_SHADOW,
  } = options
  const asked = asksOfItsOwn(materials)
  // Without local shadows (`shadowTranslucentLocalLights` off, no surface asking for them), the
  // sun's code alone is compiled, and a shadowed local light is lit whole before any read; a
  // program of no sun reads none.
  const localAny = localShadows || materials.local
  const kinds =
    (options.kinds ?? VSM_TRACE_KINDS_BOTH) &
    (localAny ? VSM_TRACE_KINDS_BOTH : VSM_TRACE_KINDS_SUN)
  // Whether each kind of light is read by the trace, as an expression of the fragment: always
  // where the project's switch says, where the surface's mark does, else never (one sample).
  const traceOf = (asks: boolean, mark: number) =>
    classic || quality > 0 ? 'true' : asks ? `(translucentShadowBits&${mark}u)!=0u` : 'false'
  const sun = traceOf(materials.directionalTrace, TRANSLUCENT_SHADOW_MARK.directionalTrace)
  const local = traceOf(materials.localTrace, TRANSLUCENT_SHADOW_MARK.localTrace)
  const reads = localAny ? [sun, local] : [sun]
  const label = `directShadowWgsl(${vsmBindingsLabel(vsm)}, ${vsmTraceBindingsLabel(trace)}, ${kinds}, ${quality > 0}, ${localShadows}${classic ? ', classic' : ''}${materialsLabel(materials)})`
  if (!kinds) {
    return wgslBlock(label, [VSM_NO_PIXEL_WGSL, shadowFactorWgsl('\n return 1.0;', asked)], '')
  }
  const traces = reads.some((read) => read !== 'false')
  const samples = reads.some((read) => read !== 'true')
  return wgslBlock(
    label,
    [
      SHADOW_SLICE_WGSL,
      vsmConsumerWgsl(vsm),
      ...(traces ? [vsmFragmentTraceWgsl(vsm.pool, trace, kinds, undefined, classic)] : []),
      ...(samples ? [vsmFragmentSampleWgsl(vsm.pool, trace.view, kinds, 0, !traces)] : []),
      shadowFactorWgsl(blendReadWgsl(sun, local, localAny, localShadows), asked),
    ],
    '',
  )
}

/**
 * The shadow read of the per-light draw (\`../deferred/perLightPassWgsl.ts\`): the program lights one shadowed local light at a time, and
 * the light's shadow is its layer of the screen mask (\`../shadows/vsm/projection/perLightPass.ts\`), the layer the light's record names
 * (\`perLight.layer\`): the pixel's blue channel, the square root of the share, squared back. A light that casts none is lit whole, a
 * surface that faces away from the light unlit whatever the mask holds. The mask is at \`mask\` of group 0, read at the pixel
 * \`vsmMaskAt\` names.
 */
const perLightShadowWgsl = ({ mask, volumeShadow }: PerLightShadowOptions) =>
  wgslBlock(
    `directShadowWgsl(perLight ${mask}${volumeShadow === undefined ? '' : ` volume ${volumeShadow}`})`,
    [
      ...(volumeShadow === undefined ? [] : [beerShadowReadWgsl(volumeShadow)]),
      shadowFactorWgsl(`
 let encoded=textureLoad(vsmPerLightMask,vsmMaskPixel,perLight.layer,0).z;
 return encoded*encoded${volumeShadow === undefined ? '' : '*beerShadowMask(light,P)'};`),
    ],
    `@group(0) @binding(${mask}) var vsmPerLightMask:texture_2d_array<f32>;
/** The resolve's pixel: the mask is read there. */
var<private> vsmMaskPixel:vec2i=vec2i(-1);
fn vsmMaskAt(coord:vec2i){vsmMaskPixel=coord;}`,
  )

/** The shadow read of an opaque lit pass: the trace the projection stored in the frame's masks. */
const maskShadowWgsl = ({ sun, local, farMask, fallback, volumeShadow }: MaskShadowOptions) =>
  wgslBlock(
    `directShadowWgsl(${sun}, ${local ?? null}, ${farMask ?? null}${fallback ? `, ${fallback.lightGrid} ${vsmBindingsLabel(fallback.vsm)} ${fallback.view}` : ''}${volumeShadow === undefined ? '' : ` volume ${volumeShadow}`})`,
    [
      vsmMaskWgsl(sun, local, farMask, fallback?.lightGrid),
      SHADOW_SLICE_WGSL,
      ...(local !== undefined && fallback
        ? [
            vsmConsumerWgsl(fallback.vsm),
            vsmTraceViewWgsl(fallback.view, VSM_TRACE_KINDS_BOTH),
            vsmSampleMapLocalWgsl(forwardPool(fallback.vsm.pool)),
          ]
        : []),
      ...(volumeShadow === undefined ? [] : [beerShadowReadWgsl(volumeShadow)]),
      shadowFactorWgsl(
        volumeShadow === undefined
          ? `
 if(shadowSliceIsSun(slice)){return vsmSunFactor(shadowSliceRecord(slice));}${
   local === undefined ? '\n return 1.0;' : '\n return vsmLocalFactor(slice,P);'
 }`
          : // The share of the light times the transmittance of the volumes toward it (HeterogeneousVolumesShadowMask.usf).
            `
 var share=1.0;
 if(shadowSliceIsSun(slice)){share=vsmSunFactor(shadowSliceRecord(slice));}${
   local === undefined ? '' : '\n else{share=vsmLocalFactor(slice,P);}'
 }
 return share*beerShadowMask(light,P);`,
      ),
    ],
    '',
  )

/** \`shadowFactor\` reading a shadowed light's share through \`read\`; with \`marks\`, the fragment's
 *  surface's marks (\`translucentShadowBits\`) its stage sets from its flags. */
const shadowFactorWgsl = (read: string, marks = false) =>
  // One name for every variant: a program holds one `shadowFactor`, and two variants listed together are refused by the assembler
  // as a name declared twice with different texts, not written twice into the module.
  wgslBlock(
    'shadowFactorWgsl',
    [],
    `/** Set by a pass that reads the sun's shadow apart (the water's separated sun, multiplied by its trace
 *  afterwards): the sun then reads as unshadowed here. */
var<private> shadowSkipSun:bool=false;${
      marks
        ? `
/** The marks of how the fragment's surface reads shadows past the project's switches
 *  (\`TRANSLUCENT_SHADOW_MARK\`), set by its stage from its item's flags. */
var<private> translucentShadowBits:u32=0u;`
        : ''
    }
fn shadowFactor(slice:i32,light:DirectLight,P:vec3f,N:vec3f,facing:bool)->f32{
 if(slice<0){return 1.0;}
 if(!facing){return 0.0;}${read}
}`,
  )

/**
 * How a translucent surface reads a light's shadow: the project's two switches, read once when the
 * session opens (`SHADOW_RULES.shadowTranslucentQuality`, `shadowTranslucentLocalLights`). `quality`
 * is 0, one sample of the light's map, or past 0, the receiver's full trace; `localShadows` says
 * whether a local light's shadow reaches the surface at all.
 */
export type TranslucentShadow = {
  quality: number
  localShadows: boolean
  /** The shadows are classic shadow maps (`shadowVirtualEnable` off): every light is read by the classic filter, whatever `quality` says. */
  classic?: boolean
  /** What the surfaces of the scene ask past the switches: the code the program holds. */
  materials?: TranslucentMaterialShadow
}

/**
 * What some surface of a scene asks of its own (`VisMaterial.translucentLocalLightShadow` and the
 * two after it), the facts a translucent program holds the code of: `local`, that a local light's
 * shadow reaches it where the project's switch says none does; `localTrace`, that the local lights'
 * shadow is traced; `directionalTrace`, that the sun's is. Each surface carries its own marks
 * (`TRANSLUCENT_SHADOW_MARK`), read in its fragments.
 */
export type TranslucentMaterialShadow = {
  local: boolean
  localTrace: boolean
  directionalTrace: boolean
}

/** No surface asks anything: the programs hold the switches' code alone. */
export const NO_TRANSLUCENT_MATERIAL_SHADOW: TranslucentMaterialShadow = {
  local: false,
  localTrace: false,
  directionalTrace: false,
}

/** Whether some surface asks anything of its own: its marks are then read in the program. */
export const asksOfItsOwn = ({ local, localTrace, directionalTrace }: TranslucentMaterialShadow) =>
  local || localTrace || directionalTrace

/** The marks a block name reads, empty where no surface asks. */
const materialsLabel = (materials: TranslucentMaterialShadow) =>
  asksOfItsOwn(materials)
    ? `, surfaces ask ${materials.local ? 'L' : ''}${materials.localTrace ? 'T' : ''}${materials.directionalTrace ? 'D' : ''}`
    : ''

/** The statement a fragment stage sets its surface's marks with from its item's `flags` (an
 *  expression of the stage), in a program whose surfaces ask (`asksOfItsOwn`). */
export const translucentMarksFrom = (flags: string) =>
  `translucentShadowBits=(${flags}>>${TRANSLUCENT_SHADOW_FLAG_SHIFT}u)&7u;`

/** The switches at their defaults: one sample, the sun's shadow alone. */
export const TRANSLUCENT_SHADOW_DEFAULT: TranslucentShadow = {
  quality: SHADOW_RULES.shadowTranslucentQuality.default,
  localShadows: SHADOW_RULES.shadowTranslucentLocalLights.default,
}

/** The switches as a block name reads them, empty where a program names none (the defaults). */
export const translucentShadowLabel = (read?: TranslucentShadow) =>
  read
    ? `, ${read.classic ? 'classic' : read.quality > 0 ? 'traced' : 'sampled'}${read.localShadows ? ', local' : ''}${read.materials ? materialsLabel(read.materials) : ''}`
    : ''

/** What a shadow read takes (`directShadowWgsl`): the pass kind — a mask read at the binding of the
 *  mask array, or a blend pass's trace with the virtual shadow maps' bindings, its trace bindings
 *  and the kinds it traces. */
type DirectShadowOptions = BlendShadowOptions | MaskShadowOptions | PerLightShadowOptions

type PerLightShadowOptions = {
  pass: 'perLight'
  /** The binding of the per-light mask, an array a layer a light. */
  mask: number
  /** Where the shadows the heterogeneous volumes cast are bound (`beerShadowReadWgsl`); left out, none is read. */
  volumeShadow?: number
}

type BlendShadowOptions = {
  pass?: 'blend'
  vsm?: VsmConsumerBindings
  trace?: VsmTraceBindings
  /** The light kinds the fragments trace (`vsmTraceKindsOf`), both unless given. */
  kinds?: number
  /** One sample (0) or the full trace (past 0): `TRANSLUCENT_SHADOW_DEFAULT`'s unless given. */
  quality?: number
  /** Whether local lights shadow: `TRANSLUCENT_SHADOW_DEFAULT`'s unless given. */
  localShadows?: boolean
  /** The shadows are classic shadow maps: one read, the classic filter's, for every light (`TranslucentShadow.classic`). */
  classic?: boolean
  /** What some surface asks of its own: none unless given. */
  materials?: TranslucentMaterialShadow
}

type MaskShadowOptions = {
  pass: 'mask'
  /** The suns' mask (a layer a sun). */
  sun: number
  /** The local lights' mask, where the pass walks local lights. */
  local?: number
  farMask?: number
  /** Where the shadows the heterogeneous volumes cast are bound (`beerShadowReadWgsl`); left out, none is read. */
  volumeShadow?: number
  /** Where the shadowed lights' grid and the maps a light past the mask's lanes is read from are bound
   *  (`local` needs them). */
  fallback?: VsmMaskReadBindings
}
