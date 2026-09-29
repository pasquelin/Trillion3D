/**
 * Every WGSL text the engine hands to `createShaderModule`, by the name of its module, each
 * variant a pass can compile under its own name: the diagnostic and water additions, the DAG's
 * external-reference screen error, each composition input. A pass that sizes its text
 * (`rasterSource`, `drawShader`, `transparentOcclusionShader`) is taken at one size: the size
 * changes a constant, never a name.
 */
import { PRESENT_SHADER } from './presentation.ts';
import { PRESENT_AT_SHADER } from './presentAt.ts';
import { transparentOcclusionShader } from './transparentOcclusionWgsl.ts';
import { DAG_SELECTION_SHADER } from '../dag/shader/shader.ts';
import { withScreenErrorVariant } from '../dag/shader/error.ts';
import { drawShader } from '../draw/shader.ts';
import { ROW_MAP_SHADER } from '../draw/lightRows.ts';
import { HIZ_SHADER } from '../hiz/shader.ts';
import { PARTITION_SHADER } from '../partition/shader.ts';
import { RESOLVE, rasterSource } from '../raster/shader.ts';
import { REST_COMPACT_SHADER } from '../raster/restCompactWgsl.ts';
import { SHADOW_CULL_SHADER, SHADOW_LIGHT_CULL_SHADER } from '../shadow/cullShader.ts';
import { SHADOW_OCCLUSION_SHADER } from '../shadow/occlusionShader.ts';
import { SHADOW_DEPTH_SHADER } from '../shadow/shader.ts';
import { PAGE_QUAD_SHADER } from '../shadow/pageQuads.ts';
import { PAGE_MOVE_SHADER } from '../shadow/pageMoves.ts';
import { BOUNCE_PROBE_SHADER } from '../../bounce/probeWgsl.ts';
import { BOUNCE_SURFACE_SHADER } from '../../bounce/surfaceWgsl.ts';
import { AS_IS_SHARE_SHADER } from '../../lighting/deferred/asIsShare.ts';
import { DIAGNOSTIC_SHADE_WGSL, DIAGNOSTIC_VIS_WGSL } from '../../diagnostic/gpuGeometry.ts';
import { DIAGNOSTIC_BLEND_WGSL } from '../../diagnostic/gpuVariant.ts';
import { BLOOM_WGSL } from '../../effects/bloomWgsl.ts';
import { GUIDE_WGSL } from '../../guides/guideShaders.ts';
import {
  BOUNCE_LIGHTING_SHADER,
  CONTRACT_COMPOSITIONS,
  contractLightingShader,
  DIRECT_LIGHTING_SHADER,
  UNLIT_COMPOSITIONS,
  UNLIT_LIGHTING_SHADER,
} from '../../lighting/deferred/shaders.ts';
import { reflectionSource, withScreenReflections } from '../../reflections/screenWgsl.ts';
import { LIGHT_TILES_SHADERS } from '../../lighting/tiles/shader.ts';
import { TAA_SHADER, taaShader } from '../../taa/shaderWgsl.ts';
import { taaUpscaleShader } from '../../taa/upscaleWgsl.ts';
import { MIP_SHADER } from '../../texture/mips.ts';
import { COVERAGE_WGSL } from '../../texture/coverageMips.ts';
import { SHADE_SHADER, VIS_SHADER } from '../../visibility/buffer.ts';
import { BLEND_EXPAND_SHADER } from '../../webgpu/blend/expandWgsl.ts';
import { BLEND_SHADER } from '../../webgpu/blend/shader.ts';
import { DISPLAY_FILTER_SHADER } from '../../webgpu/blend/displayFilterProgram.ts';
import { SHADER as PREPARE_SHADER } from '../../webgpu/pages/prepare/shaders.ts';
import { REDUCE_WGSL } from '../../webgpu/tile/reduce.ts';
import { TRANSPARENT_COMPACT_SHADER } from '../../webgpu/transparent/shader.ts';
import { WATER_COMPOSITE_SHADER, WATER_ROUTED_SHADER } from '../../webgpu/water/compositeWgsl.ts';
import { WATER_DEPTH_RESTORE_SHADER } from '../../webgpu/water/depthRestore.ts';
import { WATER_SURFACE_WGSL } from '../../webgpu/water/surfaceWgsl.ts';
import { PARTICLES_WGSL } from '../../particles/webgpuParticles.ts';
import { PARTICLE_DRAW_WGSL, PARTICLE_ROUTED_WGSL } from '../../particles/webgpuParticleDraw.ts';

const compositions = (label: string, sources: Record<string, string>) =>
  Object.fromEntries(Object.entries(sources).map(([input, code]) => [`${label}_${input}`, code]));

export const ENGINE_SHADERS: Record<string, string> = {
  PRESENT_SHADER,
  PRESENT_AT_SHADER,
  TRANSPARENT_OCCLUSION: transparentOcclusionShader(64),
  DAG_SELECTION_SHADER,
  DAG_SELECTION_REFERENCE: withScreenErrorVariant(DAG_SELECTION_SHADER, 'reference'),
  DRAW_SHADER: drawShader(2),
  ROW_MAP_SHADER,
  HIZ_SHADER,
  PARTITION_SHADER,
  RASTER: rasterSource(4096, 16),
  RESOLVE,
  REST_COMPACT_SHADER,
  SHADOW_CULL_SHADER,
  SHADOW_LIGHT_CULL_SHADER,
  SHADOW_OCCLUSION_SHADER,
  SHADOW_DEPTH_SHADER,
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
  REFLECTION_SOURCE_DIRECT: reflectionSource(DIRECT_LIGHTING_SHADER),
  REFLECTION_SOURCE_BOUNCE: reflectionSource(BOUNCE_LIGHTING_SHADER),
  REFLECTION_RESOLVE_DIRECT: withScreenReflections(DIRECT_LIGHTING_SHADER, true),
  REFLECTION_RESOLVE_BOUNCE: withScreenReflections(BOUNCE_LIGHTING_SHADER),
  DIRECT_NARROW_LIGHTING: contractLightingShader(false, true),
  BOUNCE_NARROW_LIGHTING: contractLightingShader(true, true),
  REFLECTION_SOURCE_DIRECT_NARROW: reflectionSource(contractLightingShader(false, true)),
  REFLECTION_SOURCE_BOUNCE_NARROW: reflectionSource(contractLightingShader(true, true)),
  REFLECTION_RESOLVE_DIRECT_NARROW: withScreenReflections(
    contractLightingShader(false, true),
    true,
  ),
  REFLECTION_RESOLVE_BOUNCE_NARROW: withScreenReflections(contractLightingShader(true, true)),
  ...compositions('COMPOSE', CONTRACT_COMPOSITIONS.plain),
  ...compositions('UNLIT_COMPOSE', UNLIT_COMPOSITIONS.plain),
  ...compositions('COMPOSE_BLOOM', CONTRACT_COMPOSITIONS.bloom),
  ...compositions('UNLIT_COMPOSE_BLOOM', UNLIT_COMPOSITIONS.bloom),
  ...Object.fromEntries(LIGHT_TILES_SHADERS),
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
  BLEND_EXPAND_SHADER,
  PREPARE_SHADER,
  REDUCE_WGSL,
  TRANSPARENT_COMPACT_SHADER,
  WATER_COMPOSITE_SHADER,
  WATER_ROUTED: WATER_ROUTED_SHADER,
  WATER_DEPTH_RESTORE_SHADER,
  PARTICLES_WGSL,
  PARTICLE_DRAW_WGSL,
  PARTICLE_ROUTED_WGSL,
};
