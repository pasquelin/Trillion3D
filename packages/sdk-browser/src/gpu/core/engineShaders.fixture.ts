import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { DEFORMATION_COMPUTE_WGSL } from '../../deformation/computeWgsl.ts'
import { ANIMATION_BANK_WGSL } from '../../deformation/bankWgsl.ts'
import { PRESENT_AT_SHADER } from './presentWgsl.ts'
import { transparentOcclusionShader } from './transparentOcclusionWgsl.ts'
import { DAG_SELECTION_SHADER } from '../../geometry/dag/shader/shader.ts'
import { drawShader } from '../../visibility/draw/shader.ts'
import { HIZ_SHADER } from '../../visibility/hiz/gpu/shader.ts'
import { RADIANCE_SHADER } from '../../lighting/reflections/radiance/radianceWgsl.ts'
import { REFLECTION_TRACE_SHADER } from '../../lighting/reflections/trace/trace.ts'
import { blendFrontShader } from '../../blend/frontStageWgsl.ts'
import { RUNTIME_POSE_SHADER } from '../../lighting/bounce/runtime/runtimePoseWgsl.ts'
import { SHADE_BINS_SHADER } from '../../visibility/shader/shadeBinKernelsWgsl.ts'
import { SHADE_CACHE_SHADER, SHADE_TRIS_SHADER } from '../../visibility/shader/shadeCacheWgsl.ts'
import { RESOLVE, rasterSource } from '../../visibility/raster/shader.ts'
import { binSource } from '../../visibility/raster/binWgsl.ts'
import { emptySpaceProgram } from '../../modules/sky/clouds/emptySpaceWgsl.ts'
import { CLOUD_MATERIAL_EMPTY_SPACE_WGSL } from '../../modules/sky/clouds/materialWgsl.ts'
import { LIGHTNING_CODE } from '../../modules/sky/clouds/lightningWgsl.ts'
import { cloudHazeProgram } from '../../modules/sky/clouds/traceHaze.ts'
import { cloudTraceProgram } from '../../modules/sky/clouds/traceWgsl.ts'
import { reconstructProgram } from '../../modules/sky/clouds/reconstructWgsl.ts'
import { composeProgram } from '../../modules/sky/clouds/composeWgsl.ts'
import { depthRangeProgram } from '../../modules/sky/clouds/depthRangeWgsl.ts'
import { cloudSetupOf } from '../../modules/sky/clouds/cloudModes.ts'
import { MIP_CODE } from '../../modules/sky/clouds/mipsWgsl.ts'
import { MASK_CODE } from '../../modules/sky/clouds/maskWgsl.ts'
import { NOISE_VOLUME_CODE } from '../../modules/sky/clouds/noiseVolumeWgsl.ts'
import { PATTERN_CODE } from '../../modules/sky/clouds/patternWgsl.ts'
import { PROFILE_CODE } from '../../modules/sky/clouds/profileWgsl.ts'
import { COPY_CODE, LUMINANCE_CODE } from '../../modules/sky/skyLight/copyWgsl.ts'
import { REWRITE_CODE } from '../../lighting/deferred/surfaceOverride.ts'
import {
  COMPOSE_FACE_CODE,
  fogFaceProgram,
  skyFaceProgram,
} from '../../modules/sky/skyLight/faceWgsl.ts'
import { FILTER_CODE } from '../../modules/sky/skyLight/filterWgsl.ts'
import { IRRADIANCE_CODE } from '../../modules/sky/skyLight/irradianceWgsl.ts'
import { diceSource } from '../../visibility/tessellation/diceWgsl.ts'
import { planSource } from '../../visibility/tessellation/planWgsl.ts'
import { seedSource } from '../../visibility/tessellation/seedWgsl.ts'
import { splitSource } from '../../visibility/tessellation/splitWgsl.ts'
import { POST_SHADERS } from './engineShaders.post.fixture.ts'
import { COMPOSE_SHADERS } from './engineShaders.compose.fixture.ts'
import {
  BOUNCE_PROBE_SHADER,
  BOUNCE_SNAPSHOT_SHADER,
} from '../../lighting/bounce/probes/probeWgsl.ts'
import { BOUNCE_TABLE_SHADER } from '../../lighting/bounce/probes/tableWgsl.ts'
import { BOUNCE_MARK_SHADER } from '../../lighting/bounce/markWgsl.ts'
import { BOUNCE_CENSUS_SHADER } from '../../lighting/bounce/probes/censusWgsl.ts'
import { AS_IS_SHARE_SHADER } from '../../lighting/deferred/asIsShareWgsl.ts'
import { DIAGNOSTIC_SHADE_WGSL, DIAGNOSTIC_VIS_WGSL } from '../../diagnostic/gpuGeometry.ts'
import { DIAGNOSTIC_BLEND_WGSL } from '../../diagnostic/gpuVariant.ts'
import { OUTLINE_WGSL } from '../../post/effects/outline/outlineWgsl.ts'
import { FRAME_DIFFERENCE_WGSL } from '../../frame/render/frameDifferenceWgsl.ts'
import { GUIDE_WGSL } from '../../guides/guideShaders.ts'
import { CONTRACT_COMPOSITIONS, UNLIT_COMPOSITIONS } from '../../lighting/deferred/shaders.ts'
import { lightTilesShader } from '../../lighting/tiles/shader.ts'
import { taaResolveShader } from '../../post/taa/resolveWgsl.ts'
import { spatialAntiAliasingShader } from '../../post/taa/spatialAntiAliasingWgsl.ts'
import { velocityShader } from '../../post/taa/nearestVelocityWgsl.ts'
import { SURFACE_VELOCITY_WGSL } from '../../post/taa/surfaceVelocityWgsl.ts'
import { reprojectShader } from '../../post/taa/reprojectWgsl.ts'
import { flickerPlanFor, flickerShader } from '../../post/taa/flickerWgsl.ts'
import { thinGeometryShader } from '../../post/taa/thinGeometryWgsl.ts'
import { heldMeasureShader, rejectionShader } from '../../post/taa/rejectionWgsl.ts'
import {
  COVERAGE_CHOOSE_WGSL,
  COVERAGE_COUNT_WGSL,
  MATERIAL_MIP_WGSL,
} from '../../materials/texture/mipsWgsl.ts'
import { SHADE_SHADER, shadeShader } from '../../visibility/shader/shadeWgsl.ts'
import { VIS_SHADER, visShader, visXrayShader } from '../../visibility/shader/visWgsl.ts'
import { visVoxelShader } from '../../visibility/shader/visVoxelWgsl.ts'
import { BLEND_EXPAND_SHADER } from '../../blend/expand/expandWgsl.ts'
import { BLEND_ORDER_SHADER } from '../../blend/order/orderWgsl.ts'
import { BLEND_VERDICT_SHADER } from '../../blend/verdict/verdictWgsl.ts'
import { DISPLAY_FILTER_SHADER } from '../../blend/display/displayFilterWgsl.ts'
import { GATHER_WGSL, REDUCE_WGSL } from '../../materials/virtual/reduceWgsl.ts'
import { TILE_SORT_WGSL } from '../../materials/virtual/evictSortWgsl.ts'
import { ROW_SORT_WGSL } from '../../geometry/rows/rowEvictSortWgsl.ts'
import { TRANSPARENT_COMPACT_SHADER } from '../../blend/transparent/shader.ts'
import { transmitWgsl } from '../../blend/transmission/transmitWgsl.ts'
import {
  particleDrawShader,
  particlesWgsl,
  PARTICLE_DRAW_WGSL,
} from '../../particles/gpu/particlesWgsl.ts'
import { blendShader } from '../../blend/shader.ts'
import {
  BLEND_SHADER,
  BOUNCE_LIGHTING_SHADER,
  contractLightingShader,
  DIRECT_LIGHTING_SHADER,
  TAA_SHADER,
  UNLIT_LIGHTING_SHADER,
} from './shaderTexts.fixture.ts'
import { vsmVariants } from './engineShaders.vsm.fixture.ts'
import { AIR_SHADERS, airProgramsOf } from '../../lighting/atmosphere/shaders.ts'
import { opaqueHazeProgram } from '../../lighting/atmosphere/opaqueHazeWgsl.ts'
import { airShapeOf, DEFAULT_AIR_SHAPE } from '../../lighting/atmosphere/shape.ts'
import { resolveSettings } from '../../../../sdk-core/src/contracts/settingRules.ts'
import { SKY_QUALITY_RULES } from '../../../../sdk-core/src/modules/sky/quality.ts'
import { FOG_PROGRAMS } from '../../lighting/fog/programs.ts'
import { lightFunctionRenderWgsl } from '../../lighting/lightFunction/renderWgsl.ts'
import { graphSlotWgsl, graphSlotOf } from '../../lighting/lightFunction/graphSlot.ts'
import { material } from '../../../../sdk-core/src/world/material/index.ts'
import { Texture } from '../../../../sdk-core/src/world/texture/texture.ts'
import { AO_SHADERS } from '../../lighting/ao/occlusionWgsl.ts'
import { AO_SETUP_WGSL } from '../../lighting/ao/setupWgsl.ts'
import { lightShaftProgram } from '../../modules/sky/lightShafts/wgsl.ts'
import { lightShaftTemporalProgram } from '../../modules/sky/lightShafts/temporalWgsl.ts'
import { DFAO_SHADERS } from '../../lighting/distanceField/ao/shaders.ts'

/**
 * Every WGSL text the engine hands to `createShaderModule`, by its module's name, each variant a
 * pass can compile under its own name: the diagnostic and transmissive additions, the DAG's external-
 * reference screen error, each composition input. A pass that sizes its text (`rasterSource`,
 * `drawShader`, `transparentOcclusionShader`, the virtual shadow maps by their layout) is taken
 * at one size: its size is no name.
 */

const compositions = (label: string, sources: Record<string, string>) =>
  Object.fromEntries(Object.entries(sources).map(([input, code]) => [`${label}_${input}`, code]))
/** The narrow resolve's key, without lobe code (`contractCuts.ts`). */
const NARROW = { narrow: true, lobeless: true }

/** A light function slot drawn from a graph: a panned, tinted texture (the atlas bound, the time
 *  read), or the sine of the time on a colour (nothing bound). */
function graphSlotShader(textured: boolean) {
  const g = material.graph('lightFunction')
  const colour = textured
    ? g.channel(g.textureSample(new Texture(), { uv: g.panner({ speed: [0.05, 0] }) }), 'rgb')
    : g.constant(1, 0.5, 0.25)
  g.output('emissive', g.multiply(colour, g.sine(g.time(), 2)))
  const slot = graphSlotOf(material.lightFunction({ graph: g }))
  if (!slot || !('compiled' in slot)) throw new Error('the graph slot fixture does not compile')
  return graphSlotWgsl(128, 'colour', slot)
}
/** The settings of the shapes of the air that are listed besides the defaults'. */
const AIR_SHAPES = {
  CINEMATIC: {
    skyTableFast: false,
    aerialFastOnOpaque: false,
    aerialSamplesPerSlice: 8,
    aerialDepthSlices: 32,
    skyTableSamplesMax: 256,
    atmosphereSamplesMin: 8,
    atmosphereSamplesMax: 256,
    transmittanceSamples: 30,
    multiScatterSamples: 20,
    multiScatterHighQuality: true,
    skyTablesFullPrecision: true,
  },
  SMALL: {
    transmittanceSmallFormat: true,
    transmittanceTable: false,
    atmosphereSampleLightShadowMap: false,
    distantSkyLightTable: false,
  },
}

/** The view's clouds, as the quality settings make them (`../../modules/sky/clouds/viewPrograms.ts`):
 *  the depth range passes, the trace of the plainest and of the fullest options, the haze pass, the
 *  reconstruction of the first image and of one with a history, the composition of a cloud target
 *  and of a direct trace. */
function cloudViewTexts() {
  const quality = resolveSettings(SKY_QUALITY_RULES, {})
  const target = cloudSetupOf(quality)
  const direct = cloudSetupOf({ ...quality, cloudRenderTarget: false })
  const options = { emptySpace: false, opaqueShadow: true, localLights: true }
  return {
    CLOUD_DEPTH_RANGE_DEPTH: depthRangeProgram('depth'),
    CLOUD_DEPTH_RANGE_RANGE: depthRangeProgram('range'),
    CLOUD_DEPTH_RANGE_CHECKERBOARD: depthRangeProgram('checkerboard'),
    CLOUD_TRACE_RANGE: cloudTraceProgram({ depth: 'range', minMaxDepth: true, ...options }),
    CLOUD_TRACE_SCENE: cloudTraceProgram({
      depth: 'scene',
      minMaxDepth: false,
      emptySpace: false,
      opaqueShadow: false,
      localLights: false,
    }),
    CLOUD_HAZE: cloudHazeProgram(DEFAULT_AIR_SHAPE).code,
    CLOUD_RECONSTRUCT_FIRST: reconstructProgram(target, false),
    CLOUD_RECONSTRUCT_HISTORY: reconstructProgram(target, true),
    CLOUD_COMPOSE_TARGET: composeProgram(target),
    CLOUD_COMPOSE_DIRECT: composeProgram(direct),
  }
}

export const ENGINE_SHADERS: Record<string, string> = {
  DEFORMATION_COMPUTE_WGSL,
  ANIMATION_BANK_WGSL,
  PRESENT_AT_SHADER,
  TRANSPARENT_OCCLUSION: transparentOcclusionShader(),
  DAG_SELECTION_SHADER,
  DRAW_SHADER: drawShader(2),
  DRAW_TESTED_SHADER: drawShader(2, true),
  HIZ_SHADER,
  REFLECTION_TRACE_SHADER,
  // The transparents' front stage, each of what its pass writes (`blend/frontStage.ts`).
  FRONT_STAGE_DEPTH: blendFrontShader(0),
  FRONT_STAGE_REFLECTING: blendFrontShader(1),
  FRONT_STAGE_LOBED: blendFrontShader(2),
  RUNTIME_POSE_SHADER,
  RADIANCE_SHADER,
  SHADE_BINS_SHADER,
  SHADE_CACHE_SHADER,
  SHADE_TRIS_SHADER,
  RASTER: rasterSource(4096),
  RASTER_BIN: binSource(4096),
  RASTER_BIN_TESSELLATED: binSource(4096, true),
  TESSELLATION_SEED: seedSource(),
  TESSELLATION_PLAN: planSource(),
  TESSELLATION_SPLIT: splitSource(),
  TESSELLATION_DICE: diceSource(),
  RESOLVE,
  ...COMPOSE_SHADERS,
  BOUNCE_PROBE_SHADER,
  BOUNCE_SNAPSHOT_SHADER,
  BOUNCE_TABLE_SHADER,
  BOUNCE_MARK_SHADER,
  BOUNCE_CENSUS_SHADER,
  AS_IS_SHARE_SHADER,
  ...POST_SHADERS,
  OUTLINE_WGSL,
  FRAME_DIFFERENCE_WGSL,
  GUIDE_WGSL,
  UNLIT_LIGHTING_SHADER,
  DIRECT_LIGHTING_SHADER,
  BOUNCE_LIGHTING_SHADER,
  DIRECT_NARROW_LIGHTING: contractLightingShader(false, NARROW),
  BOUNCE_NARROW_LIGHTING: contractLightingShader(true, NARROW),
  // With neither shadow nor rectangle code (#1249, #1369): each branch they drop names nothing left.
  DIRECT_UNSHADOWED_RECTLESS: contractLightingShader(false, {
    unshadowed: true,
    rectless: true,
    lobeless: true,
  }),
  // The resolve that reads one kind of shadowed light's shadow (`ShadowKinds`).
  DIRECT_SUNLESS: contractLightingShader(false, { sunless: true, lobeless: true }),
  DIRECT_LOCALLESS: contractLightingShader(false, { localless: true, lobeless: true }),
  BOUNCE_NARROW_RECTLESS_LIGHTING: contractLightingShader(true, { ...NARROW, rectless: true }),
  // The resolve of an image that holds an anisotropic or clear-coat surface (`lobesWgsl.ts`).
  DIRECT_LOBES_LIGHTING: contractLightingShader(false, {}),
  BOUNCE_LOBES_LIGHTING: contractLightingShader(true, {}),
  ...compositions('COMPOSE', CONTRACT_COMPOSITIONS.plain),
  ...compositions('UNLIT_COMPOSE', UNLIT_COMPOSITIONS.plain),
  ...compositions('COMPOSE_FINISH', CONTRACT_COMPOSITIONS.finish),
  LIGHT_TILES_SHADER: lightTilesShader('view'),
  LIGHT_TILES_WORLD_SHADER: lightTilesShader('world'),
  TAA_SHADER,
  TAA_FLAGLESS_SHADER: taaResolveShader(false),
  TAA_BLENDED_SHADER: taaResolveShader(true, true),
  TAA_RESOLVE_FILTERED: taaResolveShader(true, false, true),
  TAA_RESOLVE_FILTERED_FLAGLESS: taaResolveShader(false, false, true),
  TAA_RESOLVE_FILTERED_BLENDED: taaResolveShader(true, true, true),
  TAA_VELOCITY: velocityShader(),
  SURFACE_VELOCITY_WGSL,
  TAA_REPROJECT: reprojectShader(),
  TAA_THIN_GEOMETRY: thinGeometryShader(),
  TAA_FLICKER: flickerShader(),
  TAA_FLICKER_WIDE: flickerShader(flickerPlanFor(32768), 32768),
  TAA_HELD_MEASURE: heldMeasureShader(),
  TAA_REJECTION: rejectionShader(),
  TAA_SPATIAL_AA: spatialAntiAliasingShader(),
  MATERIAL_MIP_WGSL,
  COVERAGE_WGSL: wgslModule(COVERAGE_COUNT_WGSL),
  COVERAGE_CHOOSE_WGSL,
  VIS_SHADER,
  VIS_DIAGNOSTIC: visShader({ diagnostic: DIAGNOSTIC_VIS_WGSL }),
  VIS_XRAY_SHADER: visXrayShader(),
  VIS_VOXEL_SHADER: visVoxelShader(),
  SHADE_SHADER,
  SHADE_DIAGNOSTIC: shadeShader({ diagnostic: DIAGNOSTIC_SHADE_WGSL }),
  BLEND_SHADER,
  DISPLAY_FILTER_SHADER,
  // The transmissive stages (`../../blend/transmission/transmitWgsl.ts`), the dual blend where
  // the device grants it.
  BLEND_TRANSMIT: blendShader({}, { stage: transmitWgsl({}, false) }),
  BLEND_TRANSMIT_DUAL: blendShader({}, { stage: transmitWgsl({}, true), dual: true }),
  BLEND_TRANSMIT_LOBELESS: blendShader(
    { lobeless: true },
    { stage: transmitWgsl({ lobeless: true }, false) },
  ),
  BLEND_DIAGNOSTIC: blendShader({}, { diagnostic: DIAGNOSTIC_BLEND_WGSL }),
  // The forward passes' light loops without shadow or rectangle code (`createForwardVariants`).
  BLEND_UNSHADOWED_RECTLESS: blendShader({ unshadowed: true, rectless: true }),
  BLEND_RECTLESS: blendShader({ rectless: true }),
  BLEND_SUNLESS: blendShader({ sunless: true }),
  BLEND_LOCALLESS: blendShader({ localless: true }),
  // A scene whose blends carry no anisotropic or clear-coat lobe (`../../blend/physicalWgsl.ts`).
  BLEND_LOBELESS: blendShader({ lobeless: true }),
  BLEND_EXPAND_SHADER,
  BLEND_ORDER_SHADER,
  BLEND_VERDICT_SHADER,
  REDUCE_WGSL,
  GATHER_WGSL,
  TILE_SORT_WGSL,
  ROW_SORT_WGSL,
  TRANSPARENT_COMPACT_SHADER,
  PARTICLES_WGSL: particlesWgsl(false),
  PARTICLES_SUBGROUPS: particlesWgsl(true),
  PARTICLE_DRAW_WGSL,
  ...vsmVariants(),
  // The sky module's texts: the cloud textures' generators, the empty-space march, the sky light's
  // faces, copies and filters.
  // Only for a material that gives the output: the default one gives none, so no program is made.
  ...(CLOUD_MATERIAL_EMPTY_SPACE_WGSL ? { CLOUD_EMPTY_SPACE_CODE: emptySpaceProgram().code } : {}),
  ...cloudViewTexts(),
  MIP_CODE,
  LIGHTNING_CODE,
  MASK_CODE,
  NOISE_VOLUME_CODE,
  PATTERN_CODE,
  PROFILE_CODE,
  SKY_LIGHT_COPY_CODE: COPY_CODE,
  SURFACE_REWRITE_CODE: REWRITE_CODE,
  SKY_LIGHT_LUMINANCE_CODE: LUMINANCE_CODE,
  SKY_LIGHT_SKY_FACE_CODE: skyFaceProgram(DEFAULT_AIR_SHAPE).code,
  SKY_LIGHT_FOG_FACE_CODE: fogFaceProgram(DEFAULT_AIR_SHAPE).code,
  COMPOSE_FACE_CODE,
  FILTER_CODE,
  IRRADIANCE_CODE,
  // The atmosphere's tables, haze, sky and sums (`../../lighting/atmosphere/`).
  ...Object.fromEntries(
    Object.entries(AIR_SHADERS).map(([name, code]) => [`AIR_${name.toUpperCase()}`, code]),
  ),
  // The shapes the quality settings can make of them: the cinematic level's, which marches the sky and
  // keeps the haze and the air apart, and the smallest tables, with no table and no shadows.
  ...Object.fromEntries(
    Object.entries(AIR_SHAPES).flatMap(([shape, settings]) =>
      Object.entries(airProgramsOf(airShapeOf(resolveSettings(SKY_QUALITY_RULES, settings)))).map(
        ([name, program]) => [`AIR_${shape}_${name.toUpperCase()}`, program.code],
      ),
    ),
  ),
  // The haze marched on the opaque surfaces (`aerialFastOnOpaque` off).
  AIR_OPAQUE_HAZE: opaqueHazeProgram(
    airShapeOf(resolveSettings(SKY_QUALITY_RULES, { aerialFastOnOpaque: false })),
  ).code,
  // The fog volume's passes (`../../lighting/fog/`).
  ...Object.fromEntries(
    Object.entries(FOG_PROGRAMS).map(([name, code]) => [`FOG_${name.toUpperCase()}`, code]),
  ),
  // The light functions' atlas slot, in each format (`../../lighting/lightFunction/`).
  LIGHT_FUNCTION_SLOT_GREY: lightFunctionRenderWgsl(128, 'grey', false),
  LIGHT_FUNCTION_SLOT_COLOUR: lightFunctionRenderWgsl(128, 'colour', false),
  LIGHT_FUNCTION_SLOT_MAPPED: lightFunctionRenderWgsl(128, 'grey', true),
  LIGHT_FUNCTION_SLOT_GRAPH: graphSlotShader(true),
  LIGHT_FUNCTION_SLOT_GRAPH_PLAIN: graphSlotShader(false),
  // The screen-space ambient occlusion's setup and every shape of its search (`../../lighting/ao/`).
  AO_SETUP_WGSL,
  ...Object.fromEntries(Object.entries(AO_SHADERS).map(([name, code]) => [`AO_${name}`, code])),
  // The light shafts' passes and their temporal filter (`../../modules/sky/lightShafts/`).
  lightShaftProgram,
  lightShaftTemporalProgram,
  // The distance-field occlusion's passes (`../../lighting/distanceField/ao/`).
  ...Object.fromEntries(
    Object.entries(DFAO_SHADERS).map(([name, code]) => [`DFAO_${name.toUpperCase()}`, code]),
  ),
  // What a device with `clip-distances` compiles: the vertex stages that return the clip distance
  // of the view's plane (`../clipDistances.ts`).
  VIS_CLIP: visShader({ clipDistances: true }),
  VIS_XRAY_CLIP: visXrayShader(true),
  BLEND_CLIP: blendShader({}, { clip: true }),
  BLEND_TRANSMIT_CLIP: blendShader({}, { stage: transmitWgsl({}, false), clip: true }),
  FRONT_STAGE_CLIP: blendFrontShader(2, true),
  PARTICLE_DRAW_CLIP: particleDrawShader(true),
}
