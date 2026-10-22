import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { DEFORMATION_COMPUTE_WGSL } from '../../deformation/computeWgsl.ts'
import { ANIMATION_BANK_WGSL } from '../../deformation/bankWgsl.ts'
import { PRESENT_AT_SHADER } from './presentWgsl.ts'
import { transparentOcclusionShader } from './transparentOcclusionWgsl.ts'
import { DAG_SELECTION_SHADER, dagSelectionShader } from '../../geometry/dag/shader/shader.ts'
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
import { diceSource } from '../../visibility/tessellation/diceWgsl.ts'
import { planSource } from '../../visibility/tessellation/planWgsl.ts'
import { seedSource } from '../../visibility/tessellation/seedWgsl.ts'
import { splitSource } from '../../visibility/tessellation/splitWgsl.ts'
import { COMPOSE_SHADERS } from './engineShaders.compose.fixture.ts'
import { BLUR_SHADERS } from './engineShaders.blur.fixture.ts'
import {
  BOUNCE_PROBE_SHADER,
  BOUNCE_SNAPSHOT_SHADER,
} from '../../lighting/bounce/probes/probeWgsl.ts'
import { CACHE_FILTER_PROGRAM } from '../../lighting/bounce/cache/cacheFilterWgsl.ts'
import { CACHE_TILES_PROGRAM } from '../../lighting/bounce/cache/cacheTilesWgsl.ts'
import { CACHE_TRACE_PROGRAM } from '../../lighting/bounce/cache/cacheTraceWgsl.ts'
import { BOUNCE_TABLE_SHADER } from '../../lighting/bounce/probes/tableWgsl.ts'
import { BOUNCE_MARK_SHADER } from '../../lighting/bounce/markWgsl.ts'
import { BOUNCE_CENSUS_SHADER } from '../../lighting/bounce/probes/censusWgsl.ts'
import { AS_IS_SHARE_SHADER } from '../../lighting/deferred/asIsShareWgsl.ts'
import { DIAGNOSTIC_SHADE_WGSL, DIAGNOSTIC_VIS_WGSL } from '../../diagnostic/gpuGeometry.ts'
import { DIAGNOSTIC_BLEND_WGSL } from '../../diagnostic/gpuVariant.ts'
import { BLOOM_COMPOSITE_WGSL, BLOOM_SETUP_WGSL } from '../../post/effects/bloom/bloomWgsl.ts'
import { fftShader } from '../../post/effects/bloom/convolution/fftWgsl.ts'
import { KERNEL_WGSL } from '../../post/effects/bloom/convolution/kernelWgsl.ts'
import { CONVOLUTION_INPUT_WGSL } from '../../post/effects/bloom/convolution/inputWgsl.ts'
import {
  setupFullShader,
  setupHalfShader,
  cocDownsampleShader,
} from '../../post/effects/depthOfField/dofSetupWgsl.ts'
import { dofTemporalShader } from '../../post/effects/depthOfField/dofTemporalWgsl.ts'
import { dilateShader, cocFlattenShader } from '../../post/effects/depthOfField/dofTilesWgsl.ts'
import { dofReduceShader } from '../../post/effects/depthOfField/dofReduceWgsl.ts'
import { bokehLutShader } from '../../post/effects/depthOfField/dofLutWgsl.ts'
import { dofGatherShader } from '../../post/effects/depthOfField/dofGatherWgsl.ts'
import { dofPostfilterShader } from '../../post/effects/depthOfField/dofPostfilterWgsl.ts'
import { packShader, spriteShader } from '../../post/effects/depthOfField/dofScatterWgsl.ts'
import { dofRecombineShader } from '../../post/effects/depthOfField/dofRecombineMainWgsl.ts'
import { DOWNSAMPLE_WGSL } from '../../post/filters/downsampleWgsl.ts'
import { GAUSSIAN_WGSL } from '../../post/filters/gaussianWgsl.ts'
import { GRID_WGSL, LOG_LIGHT_WGSL } from '../../post/finish/localWgsl.ts'
import { ADAPT_WGSL, MEASURE_WGSL } from '../../post/exposure/meterWgsl.ts'
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
import { AIR_SHADERS } from '../../lighting/atmosphere/shaders.ts'
import { FOG_PROGRAMS } from '../../lighting/fog/programs.ts'
import { aoShaders } from '../../lighting/ao/shaders.fixture.ts'
import { AO_SETUP_WGSL } from '../../lighting/ao/setupWgsl.ts'

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
  CACHE_TILES_PROGRAM,
  CACHE_TRACE_PROGRAM,
  CACHE_FILTER_PROGRAM,
  AS_IS_SHARE_SHADER,
  ...BLUR_SHADERS,
  // The depth of field's passes (`../../post/effects/depthOfField/`), each at its pipeline constants' defaults.
  DOF_SETUP_HALF: setupHalfShader(),
  DOF_SETUP_FULL: setupFullShader(),
  DOF_TEMPORAL: dofTemporalShader(),
  DOF_COC_FLATTEN: cocFlattenShader(),
  DOF_COC_DILATE: dilateShader(),
  DOF_DOWNSAMPLE: cocDownsampleShader(),
  DOF_REDUCE: dofReduceShader(),
  DOF_PACK: packShader(),
  DOF_LUT: bokehLutShader(),
  DOF_GATHER: dofGatherShader(),
  DOF_POSTFILTER: dofPostfilterShader(),
  DOF_SPRITES: spriteShader(),
  DOF_RECOMBINE: dofRecombineShader(),
  BLOOM_SETUP_WGSL,
  BLOOM_COMPOSITE_WGSL,
  // The convolution bloom's transform (a line of the device's workgroup memory: 2048 or 4096 values),
  // the kernel's preparation and the image the transform reads where the level is not it.
  BLOOM_FFT_2048: fftShader(2048),
  BLOOM_FFT_4096: fftShader(4096),
  BLOOM_KERNEL_WGSL: KERNEL_WGSL,
  BLOOM_CONVOLUTION_INPUT_WGSL: CONVOLUTION_INPUT_WGSL,
  DOWNSAMPLE_WGSL,
  GAUSSIAN_WGSL,
  GRID_WGSL,
  LOG_LIGHT_WGSL,
  MEASURE_WGSL,
  ADAPT_WGSL,
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
  SHADE_DISPLACED: shadeShader({ displaced: true }),
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
  // The atmosphere's tables, haze, sky and sums (`../../lighting/atmosphere/`).
  ...Object.fromEntries(
    Object.entries(AIR_SHADERS).map(([name, code]) => [`AIR_${name.toUpperCase()}`, code]),
  ),
  // The fog volume's passes (`../../lighting/fog/`).
  ...Object.fromEntries(
    Object.entries(FOG_PROGRAMS).map(([name, code]) => [`FOG_${name.toUpperCase()}`, code]),
  ),
  // The screen-space ambient occlusion's setup and every shape of its search (`../../lighting/ao/`).
  AO_SETUP_WGSL,
  ...Object.fromEntries(Object.entries(aoShaders()).map(([name, code]) => [`AO_${name}`, code])),
  // The modules the project switch makes (`../clipDistances.ts`): the plane's distance, or the pixel's test.
  VIS_CLIP: visShader({ clipping: 'distance' }),
  VIS_CLIP_PIXEL: visShader({ clipping: 'pixel' }),
  VIS_XRAY_CLIP: visXrayShader('distance'),
  VIS_XRAY_CLIP_PIXEL: visXrayShader('pixel'),
  VIS_VOXEL_CLIP: visVoxelShader('distance'),
  BIN_CLIP_ROUTE: binSource(4096, false, true),
  DAG_SELECTION_CLIP: dagSelectionShader(true),
  BLEND_CLIP: blendShader({}, { clipping: 'distance' }),
  BLEND_CLIP_PIXEL: blendShader({}, { clipping: 'pixel' }),
  BLEND_TRANSMIT_CLIP: blendShader({}, { stage: transmitWgsl({}, false), clipping: 'distance' }),
  BLEND_TRANSMIT_CLIP_PIXEL: blendShader({}, { stage: transmitWgsl({}, false), clipping: 'pixel' }),
  FRONT_STAGE_CLIP: blendFrontShader(2, 'distance'),
  FRONT_STAGE_CLIP_PIXEL: blendFrontShader(2, 'pixel'),
  PARTICLE_DRAW_CLIP: particleDrawShader('distance'),
  PARTICLE_DRAW_CLIP_PIXEL: particleDrawShader('pixel'),
}
