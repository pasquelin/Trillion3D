import { DIRECT_LIGHT_WGSL } from './directLightWgsl.ts';
import { DIRECT_SHADOW_WGSL } from './directLightShadowWgsl.ts';

/**
 * La résolution du contrat d'éclairage direct dans le visibility buffer. La boucle du pixel est
 * bornée par la liste de sa tuile, jamais par le nombre de lampes de la scène (X2) ; Lambert et GGX
 * viennent de `standardLighting`, la seule implémentation de référence ; l'atténuation est physique
 * et s'annule à la portée ; le ciel est un terme ambiant constant.
 *
 * `mode` à 0 garde l'éclairage tel que la scène l'a écrit : les lampes du contrat s'ajoutent et rien
 * d'autre ne change. `mode` à 1 est le mode nuit — l'hôte a déclaré un environnement, les lumières
 * écrites dans la scène se taisent, et seul le ciel déclaré plus les lampes du contrat éclairent.
 */
export const DIRECT_LIGHTING_WGSL = `
${DIRECT_LIGHT_WGSL}
${DIRECT_SHADOW_WGSL}
/** Le terme ambiant du ciel : constant, sans direction, appliqué au diffus seul avec l'occlusion. */
fn skyAmbient(rgb:vec3f,metal:f32,ao:f32)->vec3f{
 return rgb*(1.0-metal)*view.sky.rgb*ao;
}
/** La contribution des lampes du contrat au pixel, tuile par tuile et lampe par lampe. */
fn contractLighting(rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,P:vec3f,ao:f32,pixel:vec2f)->vec3f{
 var result=vec3f(0.0);
 if(u32(view.lightParams.x)==0u){return result;}
 let tile=vec2u(u32(pixel.x)/TILE_SIZE,u32(pixel.y)/TILE_SIZE);
 let tilesX=u32(view.lightParams.y);
 let tilesY=u32(view.lightParams.z);
 if(tile.x>=tilesX||tile.y>=tilesY){return result;}
 let base=(tile.y*tilesX+tile.x)*TILE_STRIDE;
 let kept=min(tileLights[base],MAX_TILE_LIGHTS);
 for(var index=0u;index<kept;index++){
  let light=directLights.items[tileLights[base+4u+index]];
  let incidence=directIncidence(light,P);
  if(incidence.w<=0.0){continue;}
  let shade=shadowFactor(i32(light.params.y),light,P,N,incidence.xyz);
  if(shade<=0.0){continue;}
  let energy=light.colorIntensity.w*incidence.w*shade;
  result+=standardLighting(rgb,metal,rough,N,V,vec4f(incidence.xyz,energy),vec3f(0.0),vec3f(0.0),ao)*light.colorIntensity.rgb;
 }
 return result;
}`;
