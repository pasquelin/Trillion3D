// The engine's shader texts as it builds them by default, one copy for every test: the wide
// direct and bounce lighting (`contractLightingShader`), the TAA resolve, the blend, the shadow
// page passes, the page model, the request claims, the water composite, the colour mips and the
// wide and narrow light tiles.
import { contractLightingShader } from '../../lighting/deferred/shaders.ts';
import { taaShader } from '../../taa/shaderWgsl.ts';
import { blendShader } from '../../webgpu/blend/shader.ts';
import { allocationWgsl } from '../../webgpu/shadow/allocWgsl.ts';
import { shadowWordsWgsl } from '../../webgpu/shadow/wordsWgsl.ts';
import { shadowFreshWgsl } from '../../webgpu/shadow/freshWgsl.ts';
import { shadowDemandWgsl } from '../../webgpu/shadow/demandWgsl.ts';
import { pageModelWgsl } from '../../../../sdk-core/src/scene/light-shadow/pageModelWgsl.ts';
import { laneRequestWgsl, subgroupRequestWgsl } from '../../lighting/direct/requestLanesWgsl.ts';
import { waterCompositeShader } from '../../webgpu/water/compositeWgsl.ts';
import { mipShader } from '../../texture/mipsWgsl.ts';

export const DIRECT_LIGHTING_SHADER = contractLightingShader(false, false);
export const BOUNCE_LIGHTING_SHADER = contractLightingShader(true, false);
export const TAA_SHADER = taaShader(true);
export const BLEND_SHADER = blendShader();
export const ALLOCATION_WGSL = allocationWgsl();
export const SHADOW_WORDS_WGSL = shadowWordsWgsl();
export const SHADOW_FRESH_WGSL = shadowFreshWgsl();
export const SHADOW_DEMAND_WGSL = shadowDemandWgsl();
export const PAGE_MODEL_WGSL = pageModelWgsl();
export const LANE_REQUEST_WGSL = laneRequestWgsl();
export const SUBGROUP_REQUEST_WGSL = subgroupRequestWgsl();
export const WATER_COMPOSITE_SHADER = waterCompositeShader();
export const MIP_SHADER = mipShader(false);

