import { residentProxyWgsl } from '../../bounce/nodeWgsl.ts';
import { DIRECT_LIGHT_WGSL } from './lightWgsl.ts';
import { RECT_SHADING_WGSL } from './rectLightWgsl.ts';
import { IRRADIANCE_BAND } from '../../../../sdk-core/src/scene/core/environment.ts';
import { MODEL_FLAG, SURFACE_MODEL_LIGHT_WGSL } from '../../scene/surfaceModel.ts';
import { DIRECT_LIGHT_SAMPLING_WGSL } from './lightSamplingWgsl.ts';
import { DIRECT_SHADOW_WGSL } from './shadowWgsl.ts';
import { sunFarShadowWgsl, SUN_FAR_PROXY_BINDING } from '../../gpu/shadow/sunFarShadowWgsl.ts';
import { INVERSE_PI } from '../shaderConstants.ts';

/**
 * Base of the two lighting passes: contract types, shadow reads, and the contribution of a
 * single declared light at the point, its shadow included — the engine's only lighting
 * formula. The two loops below differ only by the light list they walk, never by the
 * physics or the surface type. A light out of range, or fully in shadow, yields exactly zero.
 *
 * The sun shadow beyond the last cascade is part of it: both passes bind the resident proxy
 * and fire the same ray. The two parameters are the **rank** of that binding, which the two
 * layouts number differently, and the right to write the two count counters; the ray itself
 * is the same character for character.
 */
const lightingBase = (proxyBinding: number, writable: boolean) => `
${DIRECT_LIGHT_WGSL}
${residentProxyWgsl(proxyBinding, writable)}
${sunFarShadowWgsl(writable)}
${DIRECT_SHADOW_WGSL}
${SURFACE_MODEL_LIGHT_WGSL}
${RECT_SHADING_WGSL}
fn declaredLight(light:DirectLight,rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,P:vec3f,ao:f32)->vec3f{
 if(isRect(light)){return rectLight(light,rgb,metal,rough,N,V,P,ao);}
 let incidence=directIncidence(light,P);
 if(incidence.w<=0.0){return vec3f(0.0);}
 let shade=shadowFactor(i32(light.params.y),light,P,N,incidence.xyz);
 if(shade<=0.0){return vec3f(0.0);}
 let energy=light.colorIntensity.w*incidence.w*shade;
 if(surfaceModel==${MODEL_FLAG.diffuse}u||surfaceModel==${MODEL_FLAG.toon}u){return modelLight(rgb,metal,N,incidence.xyz,energy,ao)*light.colorIntensity.rgb;}
 return standardLighting(rgb,metal,rough,N,V,vec4f(incidence.xyz,energy))*light.colorIntensity.rgb;
}
/** The environment's irradiance at the normal N (\`sceneEnvironment.ts\`), on the diffuse lobe:
 *  what an ambient, a sky over a ground or a probe gives a surface, never shadowed. */
fn environmentLighting(rgb:vec3f,metal:f32,N:vec3f,ao:f32)->vec3f{
 let e=directLights.environment;
 var E=e[0].rgb*${IRRADIANCE_BAND.constant}+(e[1].rgb*N.y+e[2].rgb*N.z+e[3].rgb*N.x)*${IRRADIANCE_BAND.linear};
 E+=(e[4].rgb*N.x*N.y+e[5].rgb*N.y*N.z+e[7].rgb*N.x*N.z)*${IRRADIANCE_BAND.quadraticCross};
 E+=e[6].rgb*(${IRRADIANCE_BAND.quadraticZ}*N.z*N.z-${IRRADIANCE_BAND.quadraticZOffset})+e[8].rgb*${IRRADIANCE_BAND.quadraticDifference}*(N.x*N.x-N.y*N.y);
 return rgb*(1.0-metal)*max(E,vec3f(0.0))*ao*${INVERSE_PI};
}
fn pixelTile(pixel:vec2f)->vec2u{return vec2u(u32(pixel.x)/TILE_SIZE,u32(pixel.y)/TILE_SIZE);}
/** Lights of a slice of a tile's list: its count at countSlot, its indices from firstSlot. */
fn tileLighting(rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,P:vec3f,ao:f32,tile:vec2u,tilesX:u32,countSlot:u32,firstSlot:u32)->vec3f{
 var result=vec3f(0.0);
 let base=(tile.y*tilesX+tile.x)*TILE_STRIDE;
 let kept=min(tileLights[base+countSlot],MAX_TILE_LIGHTS);
 for(var index=0u;index<kept;index++){
  result+=declaredLight(directLights.items[tileLights[base+firstSlot+index]],rgb,metal,rough,N,V,P,ao);
 }
 return result;
}`;

/**
 * Resolve of the direct-lighting contract in the visibility buffer. The pixel loop is bounded
 * by its tile list, never by the scene light count (X2); Lambert and GGX come from
 * `standardLighting`, the only reference implementation; attenuation is physical and cancels
 * at range.
 *
 * No light without a declared source (P6): there is no ambient term here, no constant sky, no
 * lighting written in the scene. A surface that no declared light reaches is exactly zero,
 * and a windowless corridor stays black in full daylight.
 *
 * `view.viewport.w` is the rank of a SAMPLED image — a moving one that temporal antialiasing
 * accumulates — and zero for every other: a still image, which converges to the exact sum,
 * and an image that does not accumulate, which is never noisy. At zero the loop is the one
 * over every light of the tile, character for character.
 */
export const DIRECT_LIGHTING_WGSL = `
${lightingBase(SUN_FAR_PROXY_BINDING, true)}
${DIRECT_LIGHT_SAMPLING_WGSL}
/** Contribution of the contract lights to the pixel, tile by tile and light by light. */
fn contractLighting(rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,P:vec3f,ao:f32,pixel:vec2f)->vec3f{
 if(u32(view.lightParams.x)==0u){return vec3f(0.0);}
 let tile=pixelTile(pixel);
 let tilesX=u32(view.lightParams.y);
 let tilesY=u32(view.lightParams.z);
 if(tile.x>=tilesX||tile.y>=tilesY){return vec3f(0.0);}
 let rank=u32(view.viewport.w);
 if(rank==0u){return tileLighting(rgb,metal,rough,N,V,P,ao,tile,tilesX,0u,4u);}
 return sampledTileLighting(rgb,metal,rough,N,V,P,ao,tile,tilesX,rank,pixel);
}`;

/**
 * Declared lights that light a blend surface, taken from the **blend slice** of its tile
 * list: the one that goes from the near plane to the opaque background, and that takes the
 * whole frustum where no opaque covers the tile. That is the slice that is needed, because a
 * blend surface is drawn in front of its pixel's opaque: the opaque slice would take declared
 * lights away from it, and foliage placed in front of the sky would keep none.
 *
 * The loop stays **exact**, and its sum is that of the loop over every light, bit for bit:
 * a light absent from the list meets no point of the slice — its range sphere does not
 * touch the world box —, so `declaredLight` would have returned exactly `vec3f(0.0)`, and
 * removing a zero from a float sum does not change it. What changes is the number of lights
 * walked, hence the number of shadow-atlas reads.
 *
 * With no list — a device that could not fit the tile pass —, the loop falls back on the
 * declared lights, bounded by `MAX_LIGHTS`, a constant known before the frame (X2).
 */
export const declaredLightingWgsl = (proxyBinding: number) => `
${lightingBase(proxyBinding, false)}
fn declaredLighting(rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,P:vec3f,ao:f32,pixel:vec2f)->vec3f{
 let tilesX=u32(uni.lightTiles.x);
 let tilesY=u32(uni.lightTiles.y);
 let tile=pixelTile(pixel);
 if(tilesX==0u||tilesY==0u||tile.x>=tilesX||tile.y>=tilesY){
  var result=vec3f(0.0);
  let count=min(directLights.count,MAX_LIGHTS);
  for(var index=0u;index<count;index++){
   result+=declaredLight(directLights.items[index],rgb,metal,rough,N,V,P,ao);
  }
  return result;
 }
 return tileLighting(rgb,metal,rough,N,V,P,ao,tile,tilesX,2u,TILE_BLEND_BASE);
}`;
