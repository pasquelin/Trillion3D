import { MODEL_FLAG } from '../../scene/surfaceModel.ts';
import { INVERSE_PI } from '../shaderConstants.ts';

/**
 * The contribution of one declared light at the point, its shadow included — the engine's only
 * lighting formula. A light out of range, or fully in shadow, yields exactly zero.
 *
 * Without `shadowed` (#1249), the program of a scene no light of which holds a shadow slot: every
 * light's `shadowFactor` answers exactly one and a transmission of exactly one, so the same terms
 * without them are the same product, bit for bit (`tests/browser/probes/narrow-resolve-gpu.ts`),
 * with none of the shadow code compiled in. That code costs an unshadowed light 40 % of its
 * evaluation although it runs none of it — the registers it holds lower the pixels in flight —,
 * timed on the resolve of 64 lamps; the program is chosen per frame (`contractVariants.ts`).
 */
export const declaredLightWgsl = (shadowed: boolean) => `
fn declaredLight(light:DirectLight,rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,P:vec3f,ao:f32)->vec3f{
 if(isRect(light)){
  var transmitted=vec3f(0.0);
  if(any(thinSubsurface>vec3f(0.0))){transmitted=thinSubsurface*rectIrradiance(light,P,-N).w*${INVERSE_PI}*light.colorIntensity.rgb*light.colorIntensity.w;}
  return rectLight(light,rgb,metal,rough,N,V,P,ao)+transmitted;
 }
 let incidence=directIncidence(light,P);
 if(incidence.w<=0.0){return vec3f(0.0);}${shadowed ? SHADE_WGSL : ''}
 let energy=light.colorIntensity.w*incidence.w${shadowed ? '*shade' : ''};
 let color=light.colorIntensity.rgb${shadowed ? '*shadowTransmission' : ''};
 let transmitted=thinSubsurface*thinTransmission(dot(N,normalize(incidence.xyz)),energy);
 if(surfaceModel==${MODEL_FLAG.diffuse}u||surfaceModel==${MODEL_FLAG.toon}u){return (modelLight(rgb,metal,N,incidence.xyz,energy,ao)+transmitted)*color;}
 return (standardLighting(rgb,metal,rough,N,V,vec4f(incidence.xyz,energy))+transmitted)*color;
}`;

const SHADE_WGSL = `
 // A surface facing away from the light gets its exact zero whatever the shadow: the filter's
 // taps are skipped, never the page reads and requests (\`shadowPcf\`). Toon bands light it.
 let back=any(thinSubsurface>vec3f(0.0))&&dot(N,incidence.xyz)<0.0;
 let facing=back||surfaceModel==${MODEL_FLAG.toon}u||select(dot(N,normalize(incidence.xyz)),dot(N,incidence.xyz),surfaceModel==${MODEL_FLAG.diffuse}u)>0.0;
 let shade=shadowFactor(i32(light.params.y),light,P+shadowReceiverOffset,select(N,-N,back),incidence.xyz,facing);
 if(shade<=0.0){return vec3f(0.0);}`;

/**
 * The one loop that shades a pixel's lights in full: the lights of
 * a slice (`tileSlice`) — or, from `TILE_NO_SLICE`, every light of the scene — that its 64-bit
 * `mask` names (#1249), in increasing rank, each bit standing for `1 << clusterShift` consecutive
 * lights. A light is first rejected on its sphere alone, before its record is read in full, where
 * it lies past its range by a ten-thousandth of its squared range: there `directIncidence` would
 * have returned zero before any shading, shadow or page read, so the sum loses an exact zero only.
 * Timed on the resolve, it takes a third off a light out of range and adds an eighth to one in
 * range. The narrow resolve's slice is the list itself (#849), read at its listed rank.
 */
export const sliceLightingWgsl = (narrow: boolean) => `
fn sliceLighting(rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,P:vec3f,ao:f32,slice:vec2u,mask:vec2u)->vec3f{
 var result=vec3f(0.0);
 let shift=clusterShift(slice.y);
 for(var index=0u;index<slice.y;index++){
  let bit=index>>shift;
  ${narrow ? 'let light=tileLights[slice.x+index];' : 'var light=index;if(slice.x!=TILE_NO_SLICE){light=tileLights[slice.x+index];}'}
  let sphere=directLights.items[light].positionRange;
  let offset=sphere.xyz-P;
  let far=abs(directLights.items[light].params.x-KIND_SUN)>=0.5&&dot(offset,offset)>sphere.w*sphere.w*RANGE_REJECT;
  if((select(mask.x,mask.y,bit>=32u)&(1u<<(bit&31u)))==0u||far){continue;}
  result+=declaredLight(directLights.items[light],rgb,metal,rough,N,V,P,ao);
 }
 return result;
}`;
