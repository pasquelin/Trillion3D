/**
 * The kernels of the demand probe (`shadow-demand-reads-gpu.ts`, #1275), from the shipped WGSL:
 * the per-pixel demand's own functions, and the shading's own read, each run at every lit point
 * for every light of the frame.
 */
import { DIRECT_LIGHT_WGSL } from '../../../packages/sdk-browser/src/lighting/direct/lightWgsl.ts';
import { SHADOW_READ_AT_WGSL } from '../../../packages/sdk-browser/src/lighting/direct/shadowFactorWgsl.ts';
import { shadowRequestWgsl } from '../../../packages/sdk-browser/src/lighting/direct/shadowRequestWgsl.ts';
import {
  SHADOW_DATA_WGSL,
  SHADOW_PAGE_READ_WGSL,
  directShadowWgsl,
} from '../../../packages/sdk-browser/src/lighting/direct/shadowWgsl.ts';
import { SHADOW_DEMAND_WGSL } from '../../../packages/sdk-browser/src/webgpu/shadow/demandWgsl.ts';
import { functionsOf } from '../../../packages/sdk-browser/src/texture/shaderRule.fixture.ts';

/** Every lit point the kernel reads: its place and footprint, its normal. */
const LITS = (binding: number) => `struct Lit{P:vec4f,N:vec4f,}
@group(0) @binding(${binding}) var<storage,read> lits:array<Lit>;`;
const LIGHTS = (binding: number) =>
  `@group(0) @binding(${binding}) var<storage,read> directLights:DirectLights;`;
const DEMANDED = ['demandPage', 'demandPages', 'demandSun', 'demandLamp', 'demandLight'];

/** The demand's own functions, run at every lit point for every light. */
export const DEMAND = `${DIRECT_LIGHT_WGSL}
${LIGHTS(3)}
${SHADOW_DATA_WGSL}
@group(0) @binding(0) var<storage,read> shadows:ShadowData;
${shadowRequestWgsl(1)}
${SHADOW_PAGE_READ_WGSL}
${SHADOW_READ_AT_WGSL}
${functionsOf(SHADOW_DEMAND_WGSL, DEMANDED)}
${LITS(2)}
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=arrayLength(&lits)){return;}
 let lit=lits[id.x];
 for(var i=0u;i<directLights.count;i++){demandLight(directLights.items[i],lit.P.xyz,lit.P.xyz,lit.N.xyz,false,lit.P.w);}
}`;

/** The shading's read at every lit point, behind the resolve's own gate (`declaredLight`). */
export const READ = `${DIRECT_LIGHT_WGSL}
${LIGHTS(7)}
@group(0) @binding(4) var shadowAtlas:texture_depth_2d_array;
@group(0) @binding(5) var shadowSampler:sampler_comparison;
fn sunFarShadowFactor(P:vec3f,N:vec3f,L:vec3f)->f32{return 1.0;}
${directShadowWgsl(0, 1, 2)}
${LITS(6)}
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=arrayLength(&lits)){return;}
 let lit=lits[id.x];
 shadowFootprint=lit.P.w;
 for(var i=0u;i<directLights.count;i++){
  let light=directLights.items[i];
  if(isRect(light)){continue;}
  let incidence=directIncidence(light,lit.P.xyz);
  if(incidence.w<=0.0){continue;}
  _=shadowFactor(i32(light.params.y),light,lit.P.xyz,lit.N.xyz,incidence.xyz,true);
 }
}`;
