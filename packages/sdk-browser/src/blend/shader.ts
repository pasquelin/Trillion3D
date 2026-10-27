import { declaredLightingWgsl } from '../lighting/direct/declaredLightingWgsl.ts'
import {
  NO_TRANSLUCENT_MATERIAL_SHADOW,
  TRANSLUCENT_SHADOW_DEFAULT,
  asksOfItsOwn,
  translucentShadowLabel,
  type TranslucentShadow,
} from '../lighting/direct/shadowWgsl.ts'
import { translucentGiWgsl } from '../lighting/translucencyGi/readWgsl.ts'
import { STANDARD_LIGHTING_WGSL } from '../lighting/standardLighting.ts'
import {
  BLEND_BINDINGS,
  BLEND_CLOUD_SHADE_BINDINGS,
  BLEND_FOG_BINDINGS,
  BLEND_LIGHT_FUNCTION_BINDINGS,
  BLEND_TRACE_BINDINGS,
  BLEND_VSM_BINDINGS,
} from '../gpu/bind/bindLayout.ts'
import { blendSurfaceWgsl } from './shaderSurface.ts'
import { blendVertexWgsl, cutBlendByPixel } from './vertexWgsl.ts'
import { NO_VERTEX_READS, cloudVertexText, type VertexReads } from './cloudVertexText.ts'
import { BLEND_PHYSICAL_WGSL } from './physicalWgsl.ts'
import { type ContractKey, variantLabel } from '../lighting/deferred/contractCuts.ts'
import { SHADOW_RULES } from '../../../sdk-core/src/contracts/shadowOptions.ts'
import { wgslModule } from '../../../math/src/wgsl/assemble.ts'
import { type WgslDecl, wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { REFLECTION_GROUP, reflectionLightViewWgsl } from '../lighting/reflections/viewLayout.ts'
import { forwardIndirectWgsl } from '../lighting/reflections/forward.ts'
import { translucencyVolumeReadWgsl } from '../lighting/translucency/readWgsl.ts'
import { BLEND_MAPS_WGSL } from './mapsWgsl.ts'
import { clipDirective, type Clipping } from '../gpu/core/clipDistances.ts'
import type { SurfaceProgram } from '../materials/graph/surfaceProgram.ts'
import { blendGraphs, depthOf } from './graphWgsl.ts'
import { NO_WPO, type WpoSet } from '../materials/graph/wpoProgram.ts'
import { blendFragmentWgsl } from './fragmentWgsl.ts'

/** Whether the translucent programs light a rectangle light as a rectangle, the project switch
 *  `translucentRectLights` at its default: off. */
export const TRANSLUCENT_RECT_LIGHTS_DEFAULT: boolean = SHADOW_RULES.translucentRectLights.default

/** The key a translucent program is lit with (`blendProgram`, `transmitWgsl`, the water's stage): `key`,
 *  with no contact shadow, which needs the scene's depth and the surfaces' flags a blend pass does not
 *  bind, and no rectangle code unless `translucentRectLights` holds, where a rectangle light is lit as a
 *  point light at its centre. */
export const translucentLitKey = (
  key: Partial<ContractKey>,
  translucentRectLights: boolean,
): Partial<ContractKey> => ({
  ...key,
  contactless: true,
  ...(!translucentRectLights && { rectless: true }),
})

/** The blend module; its light loop without the shadow or the rectangle code `key` leaves out
 *  (`declaredLightingWgsl`), the program of a scene that holds none (`pipelines.ts`). Without
 *  `lobeless`, a scene whose blend carries an anisotropic or clear-coat lobe: its fragment sets
 *  them (`physicalWgsl.ts`), its lights, environment, bounce and reflection go through them, a
 *  fragment
 *  without them summing the very same terms (`../lighting/direct/lobesWgsl.ts`). With `volume`, the
 *  module of a scene that holds a surface lit from the translucency lighting volume
 *  (`translucencyLighting`): its fragments read the volume where their material says, the plain
 *  module holding none of that code. */
const blendProgram = (
  key: Partial<ContractKey>,
  subgroups: boolean,
  clipping?: Clipping,
  programs: readonly SurfaceProgram[] = [],
  reads: VertexReads = NO_VERTEX_READS,
  localFog = true,
  offsets: WpoSet = NO_WPO,
  translucentShadow: TranslucentShadow = TRANSLUCENT_SHADOW_DEFAULT,
  volume = false,
) => {
  const lobes = !key.lobeless
  const gi = translucentGiWgsl(BLEND_BINDINGS.translucencyGi, BLEND_BINDINGS.translucencyGiSampler)
  const clouds = cloudVertexText(reads)
  const graphs = programs.length ? blendGraphs(programs, lobes) : undefined
  const bindings = {
    vsm: BLEND_VSM_BINDINGS,
    trace: { ...BLEND_TRACE_BINDINGS, subgroups },
    fog: { ...BLEND_FOG_BINDINGS, localFog },
    lightFunction: BLEND_LIGHT_FUNCTION_BINDINGS,
    // The clouds' shade, read per vertex (`blendVertexWgsl`), where the program reads the clouds.
    ...(reads.clouds && { cloudShadow: BLEND_CLOUD_SHADE_BINDINGS }),
  }
  return wgslBlock(
    `blendProgram(${variantLabel(key)}, ${subgroups}${clipping ? `, ${clipping}` : ''}${graphs ? `, ${graphs.key}` : ''}${clouds.key}${localFog ? '' : ', no local fog volumes'}${translucentShadowLabel(translucentShadow)}${volume ? ', translucency volume' : ''})`,
    [
      blendVertexWgsl(lobes, clipping, clouds, offsets),
      STANDARD_LIGHTING_WGSL,
      declaredLightingWgsl(bindings, key, translucentShadow),
      gi,
      blendSurfaceWgsl(lobes, graphs),
      forwardIndirectWgsl(REFLECTION_GROUP, lobes, BLEND_BINDINGS.frontTraced, gi),
      reflectionLightViewWgsl(REFLECTION_GROUP),
      ...(lobes ? [BLEND_PHYSICAL_WGSL] : []),
      ...(volume
        ? [translucencyVolumeReadWgsl(BLEND_BINDINGS.translucencyVolume, 'translucencyGiSampler')]
        : []),
      blendFragmentWgsl(
        lobes,
        !!graphs,
        clouds,
        asksOfItsOwn(translucentShadow.materials ?? NO_TRANSLUCENT_MATERIAL_SHADOW),
        volume,
        depthOf(programs),
      ),
      BLEND_MAPS_WGSL,
    ],
    `@group(0) @binding(${BLEND_BINDINGS.directLights}) var<storage,read> directLights:DirectLights;
@group(0) @binding(${BLEND_BINDINGS.tileLights}) var<storage,read> tileLights:array<u32>;
// The blended colour, the tile rank this pixel asks of the virtual textures, in its own target
// (no memory write: early reject kept) and the display layers (\`displayFilter.ts\`).
struct BlendOut{@location(0) color:vec4f,@location(1) request:u32,@location(2) tint:vec4f,@location(3) add:vec4f,}`,
  )
}

/** The dual blend enabled (`fsTransmitDual`, `./transmission/transmitWgsl.ts`). */
const DUAL_SOURCE_WGSL = wgslBlock('DUAL_SOURCE_WGSL', [], 'enable dual_source_blending;')

/** The blend module's text (`blendProgram`), with what a pass adds to it: the transmissive stages
 *  (`stage`, `./transmission/transmitWgsl.ts`), the dual blend enabled for them where the device
 *  grants it (`dual`), a diagnostic variant's entries (`diagnostic`); its shadow traces vote over
 *  the subgroup where the device grants subgroups (`subgroups`); made to cut at the view's plane
 *  (`clipping`: by the vertex stage's clip distance, or by each fragment stage's pixel, the module
 *  the project switch makes, `../gpu/core/clipDistances.ts`), the plain module holding none of that
 *  code; with `graphs`, holding the programs of the graphs its items wear (`graphWgsl.ts`); with
 *  `reads`, the module that reads the clouds' shade and the cloud image per vertex, and lays the fog per vertex (the
 *  project switch `cloudShadowOnTranslucent`, or a scene that holds a surface whose material has
 *  `cloudFog`: `cloudVertex.ts`, `cloudVertexText.ts`), the plain module holding none of that code
 *  either: its `stage` is built with the same flag (`transmitWgsl`); with `localFog` false, the module of a session whose project
 *  switch `localFogVolumeSupport` is off, holding none of the local fog volumes' code; with
 *  `translucentShadow`, the module of a session whose project switches `shadowTranslucentQuality`
 *  and `shadowTranslucentLocalLights` are set (`TranslucentShadow`), its fragments reading each
 *  light's shadow as they say, the defaults otherwise; with `translucentRectLights` false, the
 *  module of a session whose project switch of that name is off (the default): a rectangle light is
 *  lit as a point light, the module holding none of the rectangle shading; with
 *  `translucencyVolume`, the module of a scene that holds a surface lit from the translucency
 *  lighting volume (`translucencyVolumeOf`), reading it for the surfaces whose material says so; with
 *  `water`, the single-layer water's fragment stages of a scene that holds some. */
export const blendShader = (
  key: Partial<ContractKey> = {},
  {
    stage,
    diagnostic,
    dual = false,
    subgroups = false,
    clipping,
    graphs,
    reads = NO_VERTEX_READS,
    localFog = true,
    offsets = NO_WPO,
    translucentShadow = TRANSLUCENT_SHADOW_DEFAULT,
    translucentRectLights = TRANSLUCENT_RECT_LIGHTS_DEFAULT,
    translucencyVolume = false,
    water,
  }: {
    stage?: WgslDecl
    diagnostic?: WgslDecl
    dual?: boolean
    subgroups?: boolean
    clipping?: Clipping
    graphs?: readonly SurfaceProgram[]
    /** What its vertex stage reads: the clouds' shade and image, and the fog of the surfaces whose fog is per vertex (`VertexReads`). */
    reads?: VertexReads
    localFog?: boolean
    /** The offsets the module's vertex stage moves vertices by (`blendWpo`). */
    offsets?: WpoSet
    /** How its fragments read a light's shadow (`TranslucentShadow`). */
    translucentShadow?: TranslucentShadow
    /** Whether it lights a rectangle light as a rectangle (`translucentLitKey`). */
    translucentRectLights?: boolean
    /** Whether it reads the translucency lighting volume (`translucencyVolumeOf`). */
    translucencyVolume?: boolean
    /** The single-layer water's stage (`./water/waterStageWgsl.ts`), of a scene that holds some. */
    water?: WgslDecl
  } = {},
) => {
  const code = wgslModule(
    blendProgram(
      translucentLitKey(key, translucentRectLights),
      subgroups,
      clipping,
      graphs,
      reads,
      localFog,
      offsets,
      translucentShadow,
      translucencyVolume,
    ),
    ...(dual ? [DUAL_SOURCE_WGSL] : []),
    ...clipDirective(clipping),
    ...(stage ? [stage] : []),
    ...(water ? [water] : []),
    ...(diagnostic ? [diagnostic] : []),
  )
  return cutBlendByPixel(code, clipping)
}
