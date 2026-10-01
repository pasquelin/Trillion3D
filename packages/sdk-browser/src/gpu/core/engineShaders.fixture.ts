import { stochasticReflectionShader } from '../../reflections/sampleWgsl.ts';
import { REFLECTION_RESOLVE_WGSL } from '../../reflections/resolveWgsl.ts';
import { DEFORMATION_COMPUTE_WGSL } from '../../deformation/computeWgsl.ts';
import { PRESENT_AT_SHADER, PRESENT_SHADER } from './presentWgsl.ts';
import { transparentOcclusionShader } from './transparentOcclusionWgsl.ts';
import { DAG_SELECTION_SHADER } from '../dag/shader/shader.ts';
import { withScreenErrorVariant } from '../dag/shader/error.ts';
import { drawShader } from '../draw/shader.ts';
import { ROW_MAP_SHADER } from '../draw/lightRowsWgsl.ts';
import { HIZ_SHADER } from '../hiz/shader.ts';
import { MATERIAL_TILES_SHADER } from '../../visibility/shader/materialTilesWgsl.ts';
import { PARTITION_SHADER } from '../partition/shader.ts';
import { RESOLVE, rasterSource } from '../raster/shader.ts';
import { REST_COMPACT_SHADER } from '../raster/restCompactWgsl.ts';
import { SHADOW_CULL_SHADER, SHADOW_LIGHT_CULL_SHADER } from '../shadow/cullShader.ts';
import { shadowBinShader } from '../shadow/binShader.ts';
import { SHADOW_GROUP_PAIRS_WGSL } from '../shadow/groupWgsl.ts';
import { SHADOW_OCCLUSION_SHADER } from '../shadow/occlusionShader.ts';
import { SHADOW_DEPTH_SHADER } from '../shadow/shader.ts';
import { shadowDepthShader } from '../shadow/depthModule.ts';
import { PAGE_MOVE_SHADER, PAGE_QUAD_SHADER } from '../shadow/pageWgsl.ts';
import { SHADOW_FRESH_CULL_WGSL } from '../../webgpu/shadow/freshCullWgsl.ts';
import { BOUNCE_PROBE_SHADER } from '../../bounce/probeWgsl.ts';
import { BOUNCE_SURFACE_SHADER } from '../../bounce/surfaceWgsl.ts';
import { AS_IS_SHARE_SHADER } from '../../lighting/deferred/asIsShareWgsl.ts';
import { DIAGNOSTIC_SHADE_WGSL, DIAGNOSTIC_VIS_WGSL } from '../../diagnostic/gpuGeometry.ts';
import { DIAGNOSTIC_BLEND_WGSL } from '../../diagnostic/gpuVariant.ts';
import { BLOOM_WGSL } from '../../effects/bloomWgsl.ts';
import { GUIDE_WGSL } from '../../guides/guideShaders.ts';
import {
  CONTRACT_COMPOSITIONS,
  contractLightingShader,
  UNLIT_COMPOSITIONS,
  UNLIT_LIGHTING_SHADER,
} from '../../lighting/deferred/shaders.ts';
import { withScreenReflections } from '../../reflections/screenWgsl.ts';
import { withReflectionSourceOutput } from '../../reflections/sourceOutputWgsl.ts';
import { REFLECTION_SOURCE_WGSL } from '../../reflections/sourceWgsl.ts';
import { withSubgroupShadowRequests } from '../../lighting/direct/shadowRequestWgsl.ts';
import { LIGHT_TILES_SHADER } from '../../lighting/tiles/shader.ts';
import { taaShader } from '../../taa/shaderWgsl.ts';
import { taaUpscaleShader } from '../../taa/upscaleWgsl.ts';
import { COVERAGE_WGSL, mipShader } from '../../texture/mipsWgsl.ts';
import { SHADE_SHADER, VIS_SHADER } from '../../visibility/buffer.ts';
import { BLEND_EXPAND_SHADER } from '../../webgpu/blend/expandWgsl.ts';
import { blendShadowMarksWgsl } from '../../webgpu/blend/marksWgsl.ts';
import { DISPLAY_FILTER_SHADER } from '../../webgpu/blend/displayFilterWgsl.ts';
import { SHADER as PREPARE_SHADER } from '../../webgpu/pages/prepare/shaders.ts';
import { REDUCE_WGSL } from '../../webgpu/tile/reduceWgsl.ts';
import { TRANSPARENT_COMPACT_SHADER } from '../../webgpu/transparent/shader.ts';
import { waterCompositeShader } from '../../webgpu/water/compositeWgsl.ts';
import { waterRoutedShader } from '../../webgpu/water/routedWgsl.ts';
import { WATER_SURFACE_WGSL } from '../../webgpu/water/surfaceWgsl.ts';
import {
  PARTICLES_WGSL,
  PARTICLE_DRAW_WGSL,
  PARTICLE_ROUTED_WGSL,
} from '../../particles/particlesWgsl.ts';
import { WATER_DEPTH_RESTORE_SHADER } from '../../webgpu/water/depthRestoreShader.ts';
import {
  BLEND_SHADER,
  BOUNCE_LIGHTING_SHADER,
  DIRECT_LIGHTING_SHADER,
  TAA_SHADER,
  ALLOCATION_WGSL,
  SHADOW_WORDS_WGSL,
  SHADOW_FRESH_WGSL,
  SHADOW_DEMAND_WGSL,
  MIP_SHADER,
} from './shaderTexts.fixture.ts';
import { CARD_PASS_WGSL } from '../../webgpu/impostor/cardWgsl.ts';

/**
 * Every WGSL text the engine hands to `createShaderModule`, by its module's name, each variant a
 * pass can compile under its own name: the diagnostic and water additions, the DAG's external-
 * reference screen error, each composition input. A pass that sizes its text (`rasterSource`,
 * `drawShader`, `transparentOcclusionShader`) is taken at one size: its size is no name.
 */

const compositions = (label: string, sources: Record<string, string>) =>
  Object.fromEntries(Object.entries(sources).map(([input, code]) => [`${label}_${input}`, code]));
/** Every runtime reflection combination: lighting lobe, binding width and request mode. */
function reflectionVariants() {
  const variants: Record<string, string> = {};
  for (const bounce of [false, true])
    for (const narrow of [false, true])
      for (const subgroup of [false, true]) {
        let shader = contractLightingShader(bounce, narrow);
        if (subgroup) shader = withSubgroupShadowRequests(shader);
        const key = `REFLECTION_${bounce ? 'BOUNCE' : 'DIRECT'}_${narrow ? 'NARROW' : 'WIDE'}_${subgroup ? 'SUBGROUP' : 'PLAIN'}`;
        variants[`${key}_TRACE`] = stochasticReflectionShader(shader);
        variants[`${key}_TRACE_REFERENCE`] = stochasticReflectionShader(shader, true);
        variants[`${key}_HISTORY_COMPOSE`] = withReflectionSourceOutput(
          withScreenReflections(shader, true),
        );
      }
  return variants;
}

export const ENGINE_SHADERS: Record<string, string> = {
  DEFORMATION_COMPUTE_WGSL,
  ...reflectionVariants(),
  REFLECTION_RESOLVE_WGSL,
  REFLECTION_SOURCE_WGSL,
  MIP_DEPTH_SHADER: mipShader(true),
  PRESENT_SHADER,
  PRESENT_AT_SHADER,
  TRANSPARENT_OCCLUSION: transparentOcclusionShader(64),
  DAG_SELECTION_SHADER,
  DAG_SELECTION_REFERENCE: withScreenErrorVariant(DAG_SELECTION_SHADER, 'reference'),
  DRAW_SHADER: drawShader(2),
  ROW_MAP_SHADER,
  HIZ_SHADER,
  MATERIAL_TILES_SHADER,
  PARTITION_SHADER,
  RASTER: rasterSource(4096, 16),
  RESOLVE,
  REST_COMPACT_SHADER,
  SHADOW_CULL_SHADER,
  SHADOW_GROUP_PAIRS_WGSL,
  SHADOW_LIGHT_CULL_SHADER,
  SHADOW_OCCLUSION_SHADER,
  SHADOW_DEPTH_SHADER,
  SHADOW_BIN: shadowBinShader(false),
  SHADOW_BIN_STORED: shadowBinShader(true),
  SHADOW_DEPTH_LAMP_GROUPS: shadowDepthShader({ features: new Set(['clip-distances']) } as never),
  PAGE_QUAD_SHADER,
  PAGE_MOVE_SHADER,
  BOUNCE_PROBE_SHADER,
  BOUNCE_SURFACE_SHADER,
  AS_IS_SHARE_SHADER,
  BLOOM_WGSL,
  GUIDE_WGSL,
  UNLIT_LIGHTING_SHADER,
  DIRECT_LIGHTING_SHADER,
  BOUNCE_LIGHTING_SHADER,
  REFLECTION_RESOLVE_DIRECT: withScreenReflections(DIRECT_LIGHTING_SHADER),
  REFLECTION_RESOLVE_BOUNCE: withScreenReflections(BOUNCE_LIGHTING_SHADER),
  DIRECT_NARROW_LIGHTING: contractLightingShader(false, true),
  BOUNCE_NARROW_LIGHTING: contractLightingShader(true, true),
  // With neither shadow nor rectangle code (#1249, #1369): each branch they drop names nothing left.
  DIRECT_UNSHADOWED_RECTLESS: contractLightingShader(false, false, undefined, false, false),
  BOUNCE_NARROW_RECTLESS_LIGHTING: contractLightingShader(true, true, undefined, true, false),
  REFLECTION_RESOLVE_DIRECT_NARROW: withScreenReflections(contractLightingShader(false, true)),
  REFLECTION_RESOLVE_BOUNCE_NARROW: withScreenReflections(contractLightingShader(true, true)),
  DIRECT_SUBGROUP_LIGHTING: withSubgroupShadowRequests(DIRECT_LIGHTING_SHADER),
  BOUNCE_SUBGROUP_LIGHTING: withSubgroupShadowRequests(BOUNCE_LIGHTING_SHADER),
  REFLECTION_RESOLVE_DIRECT_SUBGROUP: withScreenReflections(
    withSubgroupShadowRequests(DIRECT_LIGHTING_SHADER),
  ),
  REFLECTION_RESOLVE_BOUNCE_SUBGROUP: withScreenReflections(
    withSubgroupShadowRequests(BOUNCE_LIGHTING_SHADER),
  ),
  DIRECT_NARROW_SUBGROUP_LIGHTING: withSubgroupShadowRequests(contractLightingShader(false, true)),
  BOUNCE_NARROW_SUBGROUP_LIGHTING: withSubgroupShadowRequests(contractLightingShader(true, true)),
  ...compositions('COMPOSE', CONTRACT_COMPOSITIONS.plain),
  ...compositions('UNLIT_COMPOSE', UNLIT_COMPOSITIONS.plain),
  ...compositions('COMPOSE_BLOOM', CONTRACT_COMPOSITIONS.bloom),
  ...compositions('UNLIT_COMPOSE_BLOOM', UNLIT_COMPOSITIONS.bloom),
  LIGHT_TILES_SHADER,
  TAA_SHADER,
  ALLOCATION_WGSL,
  SHADOW_WORDS_WGSL,
  SHADOW_FRESH_WGSL,
  SHADOW_FRESH_CULL_WGSL,
  SHADOW_DEMAND_WGSL,
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
  MIP_SHADER,
  COVERAGE_WGSL,
  VIS_SHADER,
  VIS_DIAGNOSTIC: VIS_SHADER + DIAGNOSTIC_VIS_WGSL,
  SHADE_SHADER,
  SHADE_DIAGNOSTIC: SHADE_SHADER + DIAGNOSTIC_SHADE_WGSL,
  BLEND_SHADER,
  DISPLAY_FILTER_SHADER,
  BLEND_WATER: BLEND_SHADER + WATER_SURFACE_WGSL,
  BLEND_DIAGNOSTIC: BLEND_SHADER + DIAGNOSTIC_BLEND_WGSL,
  BLEND_SHADOW_MARKS: blendShadowMarksWgsl(),
  BLEND_EXPAND_SHADER,
  PREPARE_SHADER,
  REDUCE_WGSL,
  TRANSPARENT_COMPACT_SHADER,
  WATER_COMPOSITE_SHADER: waterCompositeShader(),
  WATER_COMPOSITE_UNBOUNDED: waterCompositeShader(undefined, true),
  WATER_ROUTED: waterRoutedShader(),
  WATER_DEPTH_RESTORE_SHADER,
  PARTICLES_WGSL,
  PARTICLE_DRAW_WGSL,
  PARTICLE_ROUTED_WGSL,
  CARD_PASS_WGSL,
};
