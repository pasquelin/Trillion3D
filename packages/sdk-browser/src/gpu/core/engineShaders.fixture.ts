import { DEFORMATION_COMPUTE_WGSL } from '../../deformation/computeWgsl.ts'
import { PRESENT_AT_SHADER, PRESENT_SHADER } from './presentWgsl.ts'
import { transparentOcclusionShader } from './transparentOcclusionWgsl.ts'
import { DAG_SELECTION_SHADER } from '../dag/shader/shader.ts'
import { DAG_ARM_SHADER } from '../dag/shader/armWgsl.ts'
import { withScreenErrorVariant } from '../dag/shader/error.ts'
import { drawShader } from '../draw/shader.ts'
import { HIZ_SHADER } from '../hiz/shader.ts'
import { MATERIAL_TILES_SHADER } from '../../visibility/shader/materialTilesWgsl.ts'
import { SHADE_CACHE_SHADER, SHADE_TRIS_SHADER } from '../../visibility/shader/shadeCacheWgsl.ts'
import { PARTITION_SHADER } from '../partition/shader.ts'
import { RESOLVE, rasterSource } from '../raster/shader.ts'
import { REST_COMPACT_SHADER } from '../raster/restCompactWgsl.ts'
import { COMPOSE_ROOTS_WGSL, COMPOSE_ROWS_WGSL } from '../../placement/gpuComposeWgsl.ts'
import { BOUNCE_PROBE_SHADER, BOUNCE_SNAPSHOT_SHADER } from '../../bounce/probeWgsl.ts'
import { BOUNCE_SURFACE_SHADER } from '../../bounce/surfaceWgsl.ts'
import { AS_IS_SHARE_SHADER } from '../../lighting/deferred/asIsShareWgsl.ts'
import { DIAGNOSTIC_SHADE_WGSL, DIAGNOSTIC_VIS_WGSL } from '../../diagnostic/gpuGeometry.ts'
import { DIAGNOSTIC_BLEND_WGSL } from '../../diagnostic/gpuVariant.ts'
import { BLOOM_WGSL } from '../../webgpu/effects/bloomWgsl.ts'
import { GUIDE_WGSL } from '../../guides/guideShaders.ts'
import {
  CONTRACT_COMPOSITIONS,
  contractLightingShader,
  UNLIT_COMPOSITIONS,
  UNLIT_LIGHTING_SHADER,
} from '../../lighting/deferred/shaders.ts'
import { withScreenReflections } from '../../reflections/screenWgsl.ts'
import { LIGHT_TILES_SHADER } from '../../lighting/tiles/shader.ts'
import { taaShader } from '../../taa/shaderWgsl.ts'
import { taaUpscaleShader } from '../../taa/upscaleWgsl.ts'
import {
  COVERAGE_CHOOSE_WGSL,
  COVERAGE_WGSL,
  MATERIAL_MIP_WGSL,
  RADIANCE_MIP_WGSL,
} from '../../texture/mipsWgsl.ts'
import { SHADE_SHADER, VIS_SHADER } from '../../visibility/buffer.ts'
import { BLEND_EXPAND_SHADER } from '../../webgpu/blend/expandWgsl.ts'
import { BLEND_ORDER_SHADER } from '../../webgpu/blend/orderWgsl.ts'
import { DISPLAY_FILTER_SHADER } from '../../webgpu/blend/displayFilterWgsl.ts'
import { REDUCE_WGSL } from '../../webgpu/tile/reduceWgsl.ts'
import { TRANSPARENT_COMPACT_SHADER } from '../../webgpu/transparent/shader.ts'
import { waterCompositeShader } from '../../webgpu/water/compositeWgsl.ts'
import { waterRoutedShader } from '../../webgpu/water/routedWgsl.ts'
import { waterSurfaceWgsl } from '../../webgpu/water/surfaceWgsl.ts'
import { particlesWgsl, PARTICLE_DRAW_WGSL } from '../../webgpu/particles/particlesWgsl.ts'
import { TEXEL_TURN_WGSL } from '../../webgpu/tile/texelTurn.ts'
import { WATER_DEPTH_RESTORE_SHADER } from '../../webgpu/water/depthRestoreShader.ts'
import { blendShader } from '../../webgpu/blend/shader.ts'
import {
  BLEND_SHADER,
  BOUNCE_LIGHTING_SHADER,
  DIRECT_LIGHTING_SHADER,
  TAA_SHADER,
} from './shaderTexts.fixture.ts'
import '../../impostor/lent.fixture.ts'
import { cardPassWgsl } from '../../webgpu/impostor/cardWgsl.ts'
import { shadeWithoutFeedbackCode } from '../../webgpu/visibility/shaders.ts'
import { vsmVariants } from './engineShaders.vsm.fixture.ts'
import { reflectionShaders } from './engineShaders.reflections.fixture.ts'

/**
 * Every WGSL text the engine hands to `createShaderModule`, by its module's name, each variant a
 * pass can compile under its own name: the diagnostic and water additions, the DAG's external-
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
  ...reflectionShaders(),
  PRESENT_SHADER,
  PRESENT_AT_SHADER,
  TRANSPARENT_OCCLUSION: transparentOcclusionShader(64),
  DAG_SELECTION_SHADER,
  DAG_SELECTION_REFERENCE: withScreenErrorVariant(DAG_SELECTION_SHADER, 'reference'),
  DAG_ARM_SHADER,
  DRAW_SHADER: drawShader(2),
  HIZ_SHADER,
  MATERIAL_TILES_SHADER,
  SHADE_CACHE_SHADER,
  SHADE_TRIS_SHADER,
  PARTITION_SHADER,
  RASTER: rasterSource(4096, 16),
  RESOLVE,
  REST_COMPACT_SHADER,
  COMPOSE_ROOTS_WGSL,
  COMPOSE_ROWS_WGSL,
  BOUNCE_PROBE_SHADER,
  BOUNCE_SNAPSHOT_SHADER,
  BOUNCE_SURFACE_SHADER,
  AS_IS_SHARE_SHADER,
  BLOOM_WGSL,
  GUIDE_WGSL,
  UNLIT_LIGHTING_SHADER,
  DIRECT_LIGHTING_SHADER,
  BOUNCE_LIGHTING_SHADER,
  REFLECTION_RESOLVE_DIRECT: withScreenReflections(DIRECT_LIGHTING_SHADER),
  REFLECTION_RESOLVE_BOUNCE: withScreenReflections(BOUNCE_LIGHTING_SHADER),
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
  REFLECTION_RESOLVE_BOUNCE_LOBES: withScreenReflections(contractLightingShader(true, {})),
  REFLECTION_RESOLVE_DIRECT_NARROW: withScreenReflections(contractLightingShader(false, NARROW)),
  REFLECTION_RESOLVE_BOUNCE_NARROW: withScreenReflections(contractLightingShader(true, NARROW)),
  ...compositions('COMPOSE', CONTRACT_COMPOSITIONS.plain),
  ...compositions('UNLIT_COMPOSE', UNLIT_COMPOSITIONS.plain),
  ...compositions('COMPOSE_BLOOM', CONTRACT_COMPOSITIONS.bloom),
  ...compositions('UNLIT_COMPOSE_BLOOM', UNLIT_COMPOSITIONS.bloom),
  LIGHT_TILES_SHADER,
  TAA_SHADER,
  TAA_FLAGLESS_SHADER: taaShader(false),
  TAA_UPSCALE_SHADER: taaUpscaleShader(true),
  TAA_UPSCALE_FLAGLESS_SHADER: taaUpscaleShader(false),
  TAA_UPSCALE_BLENDED_SHADER: taaUpscaleShader(true, true),
  TAA_RESOLVE_FILTERED: taaShader(true, false, true),
  TAA_RESOLVE_FILTERED_FLAGLESS: taaShader(false, false, true),
  TAA_RESOLVE_FILTERED_BLENDED: taaShader(true, true, true),
  TAA_UPSCALE_FILTERED: taaUpscaleShader(true, false, true),
  TAA_UPSCALE_FILTERED_FLAGLESS: taaUpscaleShader(false, false, true),
  TAA_UPSCALE_FILTERED_BLENDED: taaUpscaleShader(true, true, true),
  MATERIAL_MIP_WGSL,
  RADIANCE_MIP_WGSL,
  COVERAGE_WGSL,
  COVERAGE_CHOOSE_WGSL,
  TEXEL_TURN_WGSL,
  VIS_SHADER,
  VIS_DIAGNOSTIC: VIS_SHADER + DIAGNOSTIC_VIS_WGSL,
  SHADE_SHADER,
  SHADE_DIAGNOSTIC: SHADE_SHADER + DIAGNOSTIC_SHADE_WGSL,
  // The resolve of a scene that wears no texture (`feedbackVariant.ts`).
  SHADE_WITHOUT_FEEDBACK: shadeWithoutFeedbackCode(),
  BLEND_SHADER,
  DISPLAY_FILTER_SHADER,
  BLEND_WATER: BLEND_SHADER + waterSurfaceWgsl(true),
  BLEND_DIAGNOSTIC: BLEND_SHADER + DIAGNOSTIC_BLEND_WGSL,
  // The forward passes' light loops without shadow or rectangle code (`createForwardVariants`).
  BLEND_UNSHADOWED_RECTLESS: blendShader({ unshadowed: true, rectless: true }),
  BLEND_RECTLESS: blendShader({ rectless: true }),
  BLEND_SUNLESS: blendShader({ sunless: true }),
  BLEND_LOCALLESS: blendShader({ localless: true }),
  // A scene whose blends carry no anisotropic or clear-coat lobe (`../../webgpu/blend/physicalWgsl.ts`).
  BLEND_LOBELESS: blendShader({ lobeless: true }),
  BLEND_EXPAND_SHADER,
  BLEND_ORDER_SHADER,
  REDUCE_WGSL,
  TRANSPARENT_COMPACT_SHADER,
  WATER_COMPOSITE_SHADER: waterCompositeShader(),
  WATER_COMPOSITE_UNBOUNDED: waterCompositeShader(true),
  WATER_ROUTED: waterRoutedShader(),
  WATER_COMPOSITE_UNSHADOWED_RECTLESS: waterCompositeShader(false, {
    unshadowed: true,
    rectless: true,
  }),
  WATER_COMPOSITE_SUNLESS: waterCompositeShader(false, { sunless: true }),
  WATER_COMPOSITE_LOCALLESS: waterCompositeShader(false, { localless: true }),
  // Transmissive surfaces without an anisotropic or clear-coat lobe (`waterLobesWgsl.ts`).
  WATER_COMPOSITE_LOBELESS: waterCompositeShader(false, { lobeless: true }),
  WATER_ROUTED_UNSHADOWED: waterRoutedShader(false, { unshadowed: true }),
  WATER_DEPTH_RESTORE_SHADER,
  PARTICLES_WGSL: particlesWgsl(false),
  PARTICLES_SUBGROUPS: particlesWgsl(true),
  PARTICLE_DRAW_WGSL,
  CARD_PASS_WGSL: cardPassWgsl(),
  ...vsmVariants(),
}
