import { LIGHT_KIND, LIGHT_SETTINGS, POINT_FACES } from '../sdk-core/index.ts';
import { ENVIRONMENT_COEFFICIENTS } from '../sdk-core/sceneEnvironment.ts';
import { RECT_LIGHT_WGSL } from './directRectLightWgsl.ts';
import { LTC_SIZE } from '../sdk-core/ltcTable.ts';

/**
 * Structures shared by the light-list pass and deferred resolve: a single GPU-side
 * declaration of the `SceneLight` contract, and a single physical attenuation. Shader
 * bounds come from the published settings, never from hand-written constants.
 */
export const DIRECT_LIGHT_WGSL = `
const TILE_SIZE:u32=${LIGHT_SETTINGS.tileSize}u;
/** A tile carries two lists: four header words — kept and requested of each —, the
 *  opaque list, then the blend one, which covers a deeper depth slice. */
const TILE_STRIDE:u32=${LIGHT_SETTINGS.maxLightsPerTile * 2 + 4}u;
const TILE_BLEND_BASE:u32=${LIGHT_SETTINGS.maxLightsPerTile + 4}u;
const MAX_TILE_LIGHTS:u32=${LIGHT_SETTINGS.maxLightsPerTile}u;
const MAX_LIGHTS:u32=${LIGHT_SETTINGS.maxLights}u;
const POINT_FACES:u32=${POINT_FACES}u;
const SPOT_EDGE:f32=${LIGHT_SETTINGS.spotEdgeSoftness};
const KIND_SPOT:f32=${LIGHT_KIND.spot}.0;
const KIND_SUN:f32=${LIGHT_KIND.directional}.0;
const SUN_CASCADES:u32=${LIGHT_SETTINGS.sunCascades}u;
struct DirectLight{positionRange:vec4f,colorIntensity:vec4f,directionCone:vec4f,params:vec4f,shape:vec4f,}
/** Every light slot, then the environment's irradiance: nine spherical-harmonic coefficients
 *  (\`sceneEnvironment.ts\`), zero where the host declared none; then the fitted specular lobe
 *  a rectangle is integrated with, written once (\`ltcTable.ts\`). */
struct DirectLights{count:u32,pad0:u32,pad1:u32,pad2:u32,items:array<DirectLight,MAX_LIGHTS>,environment:array<vec4f,${ENVIRONMENT_COEFFICIENTS}>,ltc:array<vec4f,${LTC_SIZE * LTC_SIZE * 2}>,}
/** The type rank is a float in the buffer: a single place knows how to reread it. */
fn isSun(light:DirectLight)->bool{return abs(light.params.x-KIND_SUN)<0.5;}
${RECT_LIGHT_WGSL}
/** Normalized direction toward the light and attenuation; w at zero when the point is out of
 *  range. A punctual light's: a rectangle has no one direction (\`rectIrradiance\`). */
fn directIncidence(light:DirectLight,P:vec3f)->vec4f{
 // A directional light has neither position nor range: the same irradiance at every point, never
 // attenuated by distance. Its direction is that of propagation, so incidence is the opposite.
 // The contract has already normalized it.
 if(isSun(light)){return vec4f(-light.directionCone.xyz,1.0);}
 let offset=light.positionRange.xyz-P;
 let distance=length(offset);
 let range=light.positionRange.w;
 if(distance>=range){return vec4f(0.0);}
 let L=offset/max(distance,1e-6);
 // Physical inverse square, windowed by range: energy cancels exactly at range.
 let ratio=distance/range;
 let window=pow(clamp(1.0-ratio*ratio*ratio*ratio,0.0,1.0),2.0);
 var attenuation=window/max(distance*distance,1e-4);
 if(abs(light.params.x-KIND_SPOT)<0.5){
  let cosine=dot(-L,light.directionCone.xyz);
  let edge=light.directionCone.w;
  // A declared penumbra widens the fade inward to its inner cone; never narrower than the edge.
  attenuation*=smoothstep(edge,max(light.params.w,edge+SPOT_EDGE),cosine);
 }
 return vec4f(L,attenuation);
}
/** Major axis of the light-to-point direction, in POINT_FACE_AXES order. */
fn pointFaceOf(direction:vec3f)->u32{
 let a=abs(direction);
 if(a.x>=a.y&&a.x>=a.z){return select(1u,0u,direction.x>0.0);}
 if(a.y>=a.z){return select(3u,2u,direction.y>0.0);}
 return select(5u,4u,direction.z>0.0);
}`;
