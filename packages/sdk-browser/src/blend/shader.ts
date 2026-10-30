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
  BLEND_LIGHT_PROFILE_BINDINGS,
  BLEND_LIGHT_PROFILE_RECT_BINDINGS,
  BLEND_TRACE_BINDINGS,
  BLEND_VSM_BINDINGS,
} from '../gpu/bind/bindLayout.ts'
import { blendSurfaceWgsl } from './shaderSurface.ts'
import { blendVertexWgsl, cutBlendByPixel } from './vertexWgsl.ts'
import { NO_VERTEX_READS, type VertexReads } from './cloudVertexText.ts'
import { BLEND_PHYSICAL_WGSL } from './physicalWgsl.ts'
import { type ContractKey, variantLabel } from '../lighting/deferred/contractCuts.ts'
import { SHADOW_RULES } from '../../../sdk-core/src/contracts/shadowOptions.ts'
import { wgslModule } from '../../../math/src/wgsl/assemble.ts'
import { type WgslDecl, wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { REFLECTION_GROUP, reflectionLightViewWgsl } from '../lighting/reflections/viewLayout.ts'
import { forwardIndirectWgsl } from '../lighting/reflections/forward.ts'
import {
  translucencyVolumeReadWgsl,
  translucencyVolumeSelfReadWgsl,
} from '../lighting/translucency/readWgsl.ts'
import {
  foldsDepth,
  foldsProfiles,
  type ObjectShadowAtlasRead,
} from '../gpu/core/objectShadowRead.ts'
import { PROFILE_FOLDED_WGSL, selfShadowText } from './objectShadow/objectShadowSelfWgsl.ts'
import { withWaterBody } from './water/waterBodyLane.ts'
import { BLEND_MAPS_WGSL } from './mapsWgsl.ts'
import { clipDirective, type Clipping } from '../gpu/core/clipDistances.ts'
import type { SurfaceProgram } from '../materials/graph/surfaceProgram.ts'
import { blendGraphs } from './graphWgsl.ts'
import { NO_WPO, type WpoSet } from '../materials/graph/wpoProgram.ts'
import type { LightAtlasFormat } from '../gpu/core/lightAtlasFormat.ts'
import { blendFragmentWgsl } from './fragmentWgsl.ts'
import { stageLobes, stageOptions } from './stageOptions.ts'
import { BLEND_LIGHT_STRENGTH_WGSL } from './viewLayout.ts'
import { withOitOrder } from './oit/oitOrder.ts'

/** Whether the translucent programs light a rectangle light as a rectangle, the project switch
 *  `translucentRectLights` at its default: off. */
export const TRANSLUCENT_RECT_LIGHTS_DEFAULT: boolean = SHADOW_RULES.translucentRectLights.default

/** What a scene decides of its translucent programs' lights, one value for the module and its stages (`blendProgram`,
 *  `transmitWgsl`, the water's stage). @property rectLights - A rectangle light is lit as a rectangle, the project switch
 *  `translucentRectLights`; else as a point light at its centre. @property contact - The programs hold the contact shadows'
 *  code, a surface of the scene asking (`contactShadowsOf`); the frame's key never says it. */
export interface TranslucentScene {
  readonly rectLights: boolean
  readonly contact: boolean
  /** The nearest translucent layer is lit by the sampled lighting (`sampledLightsFrontLayer`): the programs read the light it left for that layer. */
  readonly sampledFront?: boolean
}

/** The scene of no contact shadows and the project switch at its default. */
export const DEFAULT_TRANSLUCENT_SCENE: TranslucentScene = {
  rectLights: TRANSLUCENT_RECT_LIGHTS_DEFAULT,
  contact: false,
}

/** The key a translucent program is lit with: `key`, with no rectangle code unless the scene lights them (`rectLights`), and
 *  the contact shadows' only where the scene's surfaces ask (`contact`; the frame's key never says it). */
export const translucentLitKey = (
  key: Partial<ContractKey>,
  { rectLights, contact }: TranslucentScene,
): Partial<ContractKey> => ({
  ...key,
  ...(rectLights ? {} : { rectless: true }),
  contactless: !contact,
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
  sampledFront = false,
  rectPictures = false,
  reflectScene?: LightAtlasFormat,
  oit = false,
  objectShadow?: ObjectShadowAtlasRead,
  waterExcludes = false,
) => {
  const plain = stageOptions(
    key,
    programs,
    reads,
    asksOfItsOwn(translucentShadow.materials ?? NO_TRANSLUCENT_MATERIAL_SHADOW),
    sampledFront,
  )
  // A program that reads its object's shadow takes the record's lane in its vertex stage's extras and the shadowed volume read.
  const self =
    volume && objectShadow
      ? selfShadowText(plain.shade, reads, objectShadow, 'translucencyGiSampler')
      : undefined
  const withSelf = self ? { ...plain, shade: self.shade } : plain
  // The variant for a world that holds a water exclusion volume: the vertex stage hands the fragment the item's rank in a lane of its extras.
  const withWater = waterExcludes
    ? { ...withSelf, shade: withWaterBody(withSelf.shade, reads, !!self) }
    : withSelf
  // The program that sorts its layers per pixel takes the order of each primitive in a word of its own (`withOitOrder`).
  const options = oit ? { ...withWater, shade: withOitOrder(withWater.shade) } : withWater
  const gi = translucentGiWgsl(BLEND_BINDINGS.translucencyGi, BLEND_BINDINGS.translucencyGiSampler)
  const graphs = programs.length ? blendGraphs(programs, stageLobes(options)) : undefined
  const bindings = {
    vsm: BLEND_VSM_BINDINGS,
    trace: { ...BLEND_TRACE_BINDINGS, subgroups },
    fog: { ...BLEND_FOG_BINDINGS, localFog },
    lightFunction: BLEND_LIGHT_FUNCTION_BINDINGS,
    // Where the layout holds no profile atlas (the folded read) the profiles are read from the packed table.
    lightProfile: {
      ...(rectPictures ? BLEND_LIGHT_PROFILE_RECT_BINDINGS : BLEND_LIGHT_PROFILE_BINDINGS),
      ...(foldsProfiles(objectShadow) && { folded: PROFILE_FOLDED_WGSL }),
    },
    // The clouds' shade, read per vertex (`blendVertexWgsl`), where the program reads the clouds.
    ...(reads.clouds && { cloudShadow: BLEND_CLOUD_SHADE_BINDINGS }),
  }
  // The labels of the options that vary the program, from one list.
  const variantLabels = (
    [
      [volume, ', translucency volume'],
      [sampledFront, ', sampled front light'],
      [rectPictures, ', rectangle pictures'],
      [!!reflectScene, `, scene reflection ${reflectScene}`],
      [oit, ', sorted pixels'],
      [!!self, `, object shadow ${objectShadow}`],
      [foldsProfiles(objectShadow) && !self, ', folded profiles'],
      [oit && foldsDepth(objectShadow), ', folded sorted depth'],
      [waterExcludes, ', water exclusion lane'],
    ] as const
  )
    .filter(([on]) => on)
    .map(([, text]) => text)
    .join('')
  return wgslBlock(
    `blendProgram(${variantLabel(key)}, ${subgroups}${clipping ? `, ${clipping}` : ''}${graphs ? `, ${graphs.key}` : ''}${options.shade.key}${localFog ? '' : ', no local fog volumes'}${translucentShadowLabel(translucentShadow)}${variantLabels})`,
    [
      blendVertexWgsl(stageLobes(options), clipping, options.shade, offsets),
      STANDARD_LIGHTING_WGSL,
      BLEND_LIGHT_STRENGTH_WGSL,
      declaredLightingWgsl(bindings, key, translucentShadow),
      gi,
      blendSurfaceWgsl(stageLobes(options), graphs),
      forwardIndirectWgsl(
        REFLECTION_GROUP,
        stageLobes(options),
        BLEND_BINDINGS.frontTraced,
        gi,
        reflectScene,
      ),
      reflectionLightViewWgsl(REFLECTION_GROUP),
      ...(stageLobes(options) ? [BLEND_PHYSICAL_WGSL] : []),
      ...(volume
        ? [
            self
              ? translucencyVolumeSelfReadWgsl(
                  BLEND_BINDINGS.translucencyVolume,
                  'translucencyGiSampler',
                  self.fragment,
                )
              : translucencyVolumeReadWgsl(
                  BLEND_BINDINGS.translucencyVolume,
                  'translucencyGiSampler',
                ),
          ]
        : []),
      blendFragmentWgsl({
        ...options,
        volume,
        oit,
        selfShadow: !!self,
        foldedDepth: foldsDepth(objectShadow),
      }),
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
 *  light's shadow as they say, the defaults otherwise; with `scene` (`TranslucentScene`), the lights of the scene: with
 *  `rectLights` false, the module of a session whose project switch `translucentRectLights` is off (the default): a rectangle light is
 *  lit as a point light, the module holding none of the rectangle shading; with `contact`, the module
 *  of a scene that holds a surface whose material asks for contact shadows (`contactShadowsOf`); with
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
    scene = DEFAULT_TRANSLUCENT_SCENE,
    translucencyVolume = false,
    rectPictures = false,
    reflectScene,
    oit = false,
    objectShadow,
    water,
    waterExcludes = false,
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
    /** What its scene decides of its lights (`TranslucentScene`, `translucentLitKey`). */
    scene?: TranslucentScene
    /** Whether it reads the translucency lighting volume (`translucencyVolumeOf`). */
    translucencyVolume?: boolean
    /** Whether it reads the rectangle lights' pictures (`grantsRectPictures`); else a rectangle is plain. */
    rectPictures?: boolean
    /** The format the radiance cache's final maps are read in where the forward fragments reflect the scene (`grantsTranslucentReflection`); else they reflect the environment. */
    reflectScene?: LightAtlasFormat
    /** Whether it holds the stage that collects the layers a pixel sorts (`./oit/oitWgsl.ts`), the project switch `oitSortedPixels` on a device that grants it. */
    oit?: boolean
    /** How it reads its object's shadow in the volume read (`objectShadowAtlasRead`), none by default: the program holds none of that code (`selfShadowText`). */
    objectShadow?: ObjectShadowAtlasRead
    /** The single-layer water's stage (`./water/waterStageWgsl.ts`), of a scene that holds some. */
    water?: WgslDecl
    /** Whether the world holds a water exclusion volume (`waterExclusionVolumes`): the vertex stage carries the item's rank for the water's cut (`withWaterBody`); `water` is then the variant. */
    waterExcludes?: boolean
  } = {},
) => {
  const code = wgslModule(
    blendProgram(
      translucentLitKey(key, scene),
      subgroups,
      clipping,
      graphs,
      reads,
      localFog,
      offsets,
      translucentShadow,
      translucencyVolume,
      !!scene.sampledFront,
      rectPictures,
      reflectScene,
      oit,
      objectShadow,
      waterExcludes,
    ),
    ...(dual ? [DUAL_SOURCE_WGSL] : []),
    ...clipDirective(clipping),
    ...(stage ? [stage] : []),
    ...(water ? [water] : []),
    ...(diagnostic ? [diagnostic] : []),
  )
  return cutBlendByPixel(code, clipping)
}
