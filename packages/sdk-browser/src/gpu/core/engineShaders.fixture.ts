import { DEFORMATION_COMPUTE_WGSL } from '../../deformation/computeWgsl.ts'
import { ANIMATION_BANK_WGSL } from '../../deformation/bankWgsl.ts'
import { PRESENT_AT_SHADER } from './presentWgsl.ts'
import { BENCHMARK_WGSL } from '../benchmark/benchmarkWgsl.ts'
import { transparentOcclusionShader } from './transparentOcclusionWgsl.ts'
import { dagSelectionShader } from '../../geometry/dag/shader/shader.ts'
import { DAG_SELECTION_SHADER } from '../../geometry/dag/shader/selectionShader.fixture.ts'
import { HIZ_SHADER } from '../../visibility/hiz/gpu/shader.ts'
import { reflectionTraceShader } from '../../lighting/reflections/trace/trace.ts'
import { blendFrontShader } from '../../blend/frontStageWgsl.ts'
import {
  SHADE_BINS_SHADER,
  SHADE_BINS_SUBGROUP_SHADERS,
} from '../../visibility/shader/shadeBinKernelsWgsl.ts'
import { rasterSource } from '../../visibility/raster/shader.ts'
import { decodePlanSource, decodeSource } from '../../visibility/decode/decodeWgsl.ts'
import { binsSource } from '../../visibility/bins/binsWgsl.ts'
import { measureSource } from '../../geometry/dag/info/measureWgsl.ts'
import { DEPTH_EXPORT_SHADER, exportSource } from '../../visibility/raster/exportWgsl.ts'
import { REWRITE_CODE } from '../../lighting/deferred/surfaceRewriteWgsl.ts'
import { diceSource } from '../../visibility/tessellation/diceWgsl.ts'
import { planSource } from '../../visibility/tessellation/planWgsl.ts'
import { seedSource } from '../../visibility/tessellation/seedWgsl.ts'
import { splitSource } from '../../visibility/tessellation/splitWgsl.ts'
import { POST_SHADERS } from './engineShaders.post.fixture.ts'
import { COMPOSE_SHADERS } from './engineShaders.compose.fixture.ts'
import { SURFACE_CACHE_SHADERS } from './engineShaders.surfaceCache.fixture.ts'
import { SCENE_TRACE_SHADERS } from './engineShaders.sceneTrace.fixture.ts'
import { BLUR_SHADERS } from './engineShaders.blur.fixture.ts'
import { FOG_SHADERS, NO_LOCAL_FOG_SHADERS } from './engineShaders.fog.fixture.ts'
import { wpoShaders } from './engineShaders.wpo.fixture.ts'
import { SKY_SHADERS } from './engineShaders.sky.fixture.ts'
import { LIGHTING_SHADERS, LIT_PASS_SHADERS } from './engineShaders.lighting.fixture.ts'
import { BLEND_SHADER } from './shaderTexts.fixture.ts'
import { waterCopyShader, waterMaskShader } from '../../blend/water/waterPassWgsl.ts'
import { waterTileKernels } from '../../blend/water/waterTileWgsl.ts'
import { TAA_SHADERS } from './engineShaders.taa.fixture.ts'
import { CACHE_FILTER_PROGRAM } from '../../lighting/bounce/cache/cacheFilterWgsl.ts'
import { CACHE_MIPS_PROGRAM } from '../../lighting/bounce/cache/cacheMipsWgsl.ts'
import { CACHE_TILES_PROGRAM } from '../../lighting/bounce/cache/cacheTilesWgsl.ts'
import { CACHE_TRACE_PROGRAM } from '../../lighting/bounce/cache/cacheTraceWgsl.ts'
import { POOL_FINISH_SHADER, POOL_SHADER } from '../../lighting/bounce/pool/poolWgsl.ts'
import { MARK_IMAGE_SHADER, MARK_PROBES_SHADER } from '../../lighting/bounce/pool/poolMarkWgsl.ts'
import { DIAGNOSTIC_SHADE_WGSL, diagnosticVisWgsl } from '../../diagnostic/gpuGeometry.ts'
import { DIAGNOSTIC_BLEND_WGSL } from '../../diagnostic/gpuVariant.ts'
import { OUTLINE_WGSL } from '../../post/effects/outline/outlineWgsl.ts'
import { FRAME_DIFFERENCE_WGSL } from '../../frame/render/frameDifferenceWgsl.ts'
import { GUIDE_WGSL } from '../../guides/guideShaders.ts'
import { CONTRACT_COMPOSITIONS, UNLIT_COMPOSITIONS } from '../../lighting/deferred/shaders.ts'
import { lightTilesShader } from '../../lighting/tiles/shader.ts'
import { MATERIAL_MIP_WGSL } from '../../materials/texture/mipsWgsl.ts'
import { SHADE_SHADER, shadeShader } from '../../visibility/shader/shadeWgsl.ts'
import { visShader, visXrayShader } from '../../visibility/shader/visWgsl.ts'
import { VIS_SHADER } from '../../visibility/shader/visShader.fixture.ts'
import { visVoxelShader } from '../../visibility/shader/visVoxelWgsl.ts'
import { BLEND_EXPAND_SHADER } from '../../blend/expand/expandWgsl.ts'
import { BLEND_ORDER_SHADER } from '../../blend/order/orderWgsl.ts'
import { BLEND_VERDICT_SHADER } from '../../blend/verdict/verdictWgsl.ts'
import { DISPLAY_FILTER_SHADER } from '../../blend/display/displayFilterWgsl.ts'
import { GATHER_WGSL, REDUCE_WGSL } from '../../materials/virtual/reduceWgsl.ts'
import { PAGE_LINK_WGSL, PAGE_TRANSCODE_WGSL } from '../../geometry/pages/install/transcodeWgsl.ts'
import { TILE_SORT_WGSL } from '../../materials/virtual/evictSortWgsl.ts'
import { TRANSPARENT_COMPACT_SHADER } from '../../blend/transparent/shader.ts'
import { transmitWgsl } from '../../blend/transmission/transmitWgsl.ts'
import {
  particleDrawShader,
  particlesWgsl,
  PARTICLE_DRAW_WGSL,
} from '../../particles/gpu/particlesWgsl.ts'
import { blendShader } from '../../blend/shader.ts'
import { vsmVariants } from './engineShaders.vsm.fixture.ts'
import { isProgram, programOf } from '../../materials/graph/surfaceProgram.ts'
import { maskGraphSets } from './engineShaders.mask.fixture.ts'
import { material } from '../../../../sdk-core/src/world/material/index.ts'
import { Texture } from '../../../../sdk-core/src/world/texture/texture.ts'

const CLOUDS = { clouds: true, fog: false }
const FOG = { clouds: false, fog: true }
const CLOUDS_AND_FOG = { clouds: true, fog: true }

/**
 * Every WGSL text the engine hands to `createShaderModule`, by its module's name, each variant a
 * pass can compile under its own name: the diagnostic and transmissive additions, the DAG's external-
 * reference screen error, each composition input. A pass that sizes its text (`transparentOcclusionShader`,
 * the virtual shadow maps by their layout) is taken at one size: its size is no name.
 */

const compositions = (label: string, sources: Record<string, string>) =>
  Object.fromEntries(Object.entries(sources).map(([input, code]) => [`${label}_${input}`, code]))
/** The program of a surface graph that reads two textures, the vertex colour and the camera's vector,
 *  wires a normal, the lobes and the specular and reads the time: what the resolve of its class (`shadeShader`'s `graph`) is made of; of an unlit
 *  surface (`lit` false) it compiles its emission alone. */
function surfaceGraphProgram(lit = true) {
  const g = material.graph('surface')
  const uv = g.panner({ speed: [0.05, 0], coordinate: g.texCoord(0, 4, 4) })
  const read = g.textureSample(new Texture(), { uv })
  g.output('baseColor', g.channel(read, 'rgb'))
  g.output(
    'roughness',
    g.channel(g.textureSample(new Texture(), { mipMode: 'level', mip: 1 }), 'r'),
  )
  g.output('normal', g.constant(0, 0, 1))
  // The vertex colour and the vector to the camera, which a resolve fills (`shadeGraphWgsl.ts`).
  const tint = g.channel(g.vertexColor(), 'rgb')
  g.output('emissive', g.multiply(g.multiply(g.constant(1, 0.5, 0.25), g.sine(g.time(), 2)), tint))
  g.output('anisotropy', g.constant(-0.5))
  g.output('tangent', g.constant(0, 1, 0))
  g.output('clearCoat', g.constant(1))
  g.output('specular', g.multiply(g.constant(0.8), g.componentMask(g.cameraVector(), 'b')))
  const program = programOf({ graph: g, lit })
  if (!isProgram(program)) throw new Error('the surface graph fixture does not compile')
  return program.compiled
}
/** The program of a translucent surface's graph for the transparent pass: a tinted, panned texture
 *  at a set past the first, its opacity from the time, a normal, a thin transmission, the lobes, the
 *  specular and a refraction wired. */
function blendGraphPrograms() {
  const g = material.graph('surface')
  const uv = g.panner({ speed: [0.05, 0], coordinate: g.texCoord(2, 2, 2) })
  const read = g.textureSample(new Texture(), { uv })
  g.output('baseColor', g.channel(read, 'rgb'))
  g.output('opacity', g.multiply(g.channel(read, 'a'), g.sine(g.time(), 2)))
  g.output('normal', g.constant(0, 0, 1))
  g.output('subsurfaceColor', g.constant(0.5, 0.5, 0.5))
  g.output('anisotropy', g.constant(0.4))
  g.output('clearCoat', g.constant(0.5))
  g.output('specular', g.constant(0.7))
  g.output(
    'refraction',
    g.multiply(g.constant(1.33), g.add(g.constant(1), g.componentMask(g.cameraVector(), 'b'))),
  )
  const program = programOf({ graph: g, transparent: true })
  if (!isProgram(program)) throw new Error('the blend graph fixture does not compile')
  return [program]
}

export const ENGINE_SHADERS: Record<string, string> = {
  DEFORMATION_COMPUTE_WGSL,
  ANIMATION_BANK_WGSL,
  PRESENT_AT_SHADER,
  // The hardware benchmark's programs (`../benchmark/gpuBenchmark.ts`).
  BENCHMARK_WGSL,
  TRANSPARENT_OCCLUSION: transparentOcclusionShader(),
  DAG_SELECTION_SHADER,
  HIZ_SHADER,
  REFLECTION_TRACE_SHADER: reflectionTraceShader(false),
  REFLECTION_TRACE_STATISTICS_SHADER: reflectionTraceShader(true),
  // The transparents' front stage, each of what its pass writes (`blend/frontStage.ts`).
  FRONT_STAGE_DEPTH: blendFrontShader(0),
  FRONT_STAGE_REFLECTING: blendFrontShader(1),
  FRONT_STAGE_LOBED: blendFrontShader(2),
  SHADE_BINS_SHADER,
  SHADE_BINS_SUBGROUP_SHADER: SHADE_BINS_SUBGROUP_SHADERS[64],
  SHADE_BINS_SUBGROUP_32_SHADER: SHADE_BINS_SUBGROUP_SHADERS[32],
  // The visible clusters' decode and its plan, the bins of one coplanar layer and of three, the
  // measure of the clusters' edges.
  DECODE_SHADER: decodeSource(),
  DECODE_PLAN_SHADER: decodePlanSource(),
  BINS_SHADER: binsSource(1),
  BINS_LAYERS_SHADER: binsSource(3),
  CLUSTER_MEASURE_SHADER: measureSource(),
  RASTER: rasterSource(),
  RASTER_WIDE: rasterSource(undefined, undefined, true),
  RASTER_SUBGROUPS: rasterSource(undefined, undefined, false, true),
  RASTER_MASKED: rasterSource(maskGraphSets().camera),
  RASTER_MASKED_WIDE: rasterSource(maskGraphSets().camera, undefined, true),
  RASTER_EXPORT: exportSource(false),
  RASTER_EXPORT_WIDE: exportSource(true),
  RASTER_DEPTH_EXPORT: DEPTH_EXPORT_SHADER,
  TESSELLATION_SEED: seedSource(),
  TESSELLATION_PLAN: planSource(),
  TESSELLATION_SPLIT: splitSource(),
  TESSELLATION_SPLIT_CLIP: splitSource(true),
  TESSELLATION_DICE: diceSource(),
  TESSELLATION_DICE_WIDE: diceSource(undefined, undefined, true),
  TESSELLATION_DICE_MASKED: diceSource(maskGraphSets().dice),
  ...COMPOSE_SHADERS,
  ...SURFACE_CACHE_SHADERS,
  ...SCENE_TRACE_SHADERS,
  POOL_SHADER,
  POOL_FINISH_SHADER,
  MARK_IMAGE_SHADER,
  MARK_PROBES_SHADER,
  CACHE_TILES_PROGRAM,
  CACHE_TRACE_PROGRAM,
  CACHE_FILTER_PROGRAM,
  CACHE_MIPS_PROGRAM,
  ...POST_SHADERS,
  ...BLUR_SHADERS,
  ...FOG_SHADERS,
  ...NO_LOCAL_FOG_SHADERS,
  ...wpoShaders(),
  OUTLINE_WGSL,
  FRAME_DIFFERENCE_WGSL,
  GUIDE_WGSL,
  ...LIT_PASS_SHADERS,
  ...compositions('COMPOSE', CONTRACT_COMPOSITIONS.plain),
  ...compositions('UNLIT_COMPOSE', UNLIT_COMPOSITIONS.plain),
  ...compositions('COMPOSE_FINISH', CONTRACT_COMPOSITIONS.finish),
  LIGHT_TILES_SHADER: lightTilesShader(),
  ...TAA_SHADERS,
  MATERIAL_MIP_WGSL,
  VIS_SHADER,
  VIS_DIAGNOSTIC: visShader({ diagnostic: diagnosticVisWgsl(false) }),
  VIS_DIAGNOSTIC_WIDE: visShader({ diagnostic: diagnosticVisWgsl(true), wide: true }),
  VIS_XRAY_SHADER: visXrayShader(),
  VIS_VOXEL_SHADER: visVoxelShader(),
  VIS_WIDE: visShader({ wide: true }),
  VIS_MASKED_WIDE: visShader({ masks: maskGraphSets().camera, wide: true }),
  VIS_VOXEL_WIDE: visVoxelShader(undefined, undefined, true),
  SHADE_SHADER,
  SHADE_DIAGNOSTIC: shadeShader({ diagnostic: DIAGNOSTIC_SHADE_WGSL }),
  SHADE_DISPLACED: shadeShader({ displaced: true }),
  SHADE_GRAPH: shadeShader({ graph: surfaceGraphProgram() }),
  SHADE_GRAPH_DISPLACED: shadeShader({ graph: surfaceGraphProgram(), displaced: true }),
  SHADE_GRAPH_UNLIT: shadeShader({ graph: surfaceGraphProgram(false) }),
  BLEND_SHADER,
  WATER_COPY: waterCopyShader(),
  WATER_MASK: waterMaskShader(),
  WATER_TILES: waterTileKernels(false),
  WATER_TILES_WAVED: waterTileKernels(true),
  DISPLAY_FILTER_SHADER,
  // The transmissive stages (`../../blend/transmission/transmitWgsl.ts`), the dual blend where
  // the device grants it.
  BLEND_GRAPH: blendShader({}, { graphs: blendGraphPrograms() }),
  BLEND_GRAPH_LOBELESS: blendShader({ lobeless: true }, { graphs: blendGraphPrograms() }),
  BLEND_GRAPH_TRANSMIT: blendShader(
    {},
    { stage: transmitWgsl({}, false, blendGraphPrograms()), graphs: blendGraphPrograms() },
  ),
  FRONT_STAGE_GRAPH: blendFrontShader(2, undefined, blendGraphPrograms()),
  FRONT_STAGE_GRAPH_DEPTH: blendFrontShader(0, undefined, blendGraphPrograms()),
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
  PAGE_TRANSCODE_WGSL,
  PAGE_LINK_WGSL,
  TILE_SORT_WGSL,
  TRANSPARENT_COMPACT_SHADER,
  PARTICLES_WGSL: particlesWgsl(false),
  PARTICLES_SUBGROUPS: particlesWgsl(true),
  PARTICLE_DRAW_WGSL,
  ...vsmVariants(),
  SURFACE_REWRITE_CODE: REWRITE_CODE,
  ...SKY_SHADERS,
  ...LIGHTING_SHADERS,
  // The modules the project switch makes (`../clipDistances.ts`): the plane's distance, or the pixel's test.
  VIS_CLIP: visShader({ clipping: 'distance' }),
  VIS_MASKED: visShader({ masks: maskGraphSets().camera }),
  VIS_MASKED_CLIP_PIXEL: visShader({ clipping: 'pixel', masks: maskGraphSets().camera }),
  VIS_CLIP_PIXEL: visShader({ clipping: 'pixel' }),
  VIS_XRAY_CLIP: visXrayShader('distance'),
  VIS_XRAY_CLIP_PIXEL: visXrayShader('pixel'),
  VIS_VOXEL_CLIP: visVoxelShader('distance'),
  DAG_SELECTION_CLIP: dagSelectionShader(true),
  BLEND_CLIP: blendShader({}, { clipping: 'distance' }),
  BLEND_CLIP_PIXEL: blendShader({}, { clipping: 'pixel' }),
  BLEND_TRANSMIT_CLIP: blendShader({}, { stage: transmitWgsl({}, false), clipping: 'distance' }),
  BLEND_TRANSMIT_CLIP_PIXEL: blendShader({}, { stage: transmitWgsl({}, false), clipping: 'pixel' }),
  // The programs that read the clouds per vertex (the project switch `cloudShadowOnTranslucent`, or
  // a scene with a surface whose material has `cloudFog`): the clouds' shade and the cloud image.
  BLEND_CLOUD_VERTEX: blendShader({}, { reads: CLOUDS }),
  BLEND_TRANSMIT_CLOUD_VERTEX: blendShader(
    {},
    { stage: transmitWgsl({}, true, undefined, CLOUDS), dual: true, reads: CLOUDS },
  ),
  // The programs that lay the fog per vertex (a scene with a surface whose fog is not per pixel), with and
  // without the clouds, and the transmissive stages over them.
  BLEND_FOG_VERTEX: blendShader({}, { reads: FOG }),
  BLEND_CLOUD_FOG_VERTEX: blendShader({}, { reads: CLOUDS_AND_FOG }),
  BLEND_TRANSMIT_FOG_VERTEX: blendShader(
    {},
    {
      stage: transmitWgsl({}, true, undefined, CLOUDS_AND_FOG),
      dual: true,
      reads: CLOUDS_AND_FOG,
    },
  ),
  FRONT_STAGE_CLIP: blendFrontShader(2, 'distance'),
  FRONT_STAGE_CLIP_PIXEL: blendFrontShader(2, 'pixel'),
  PARTICLE_DRAW_CLIP: particleDrawShader('distance'),
  PARTICLE_DRAW_CLIP_PIXEL: particleDrawShader('pixel'),
}
