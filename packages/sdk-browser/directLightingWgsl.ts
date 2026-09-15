import { DIRECT_LIGHT_WGSL } from './directLightWgsl.ts';
import { DIRECT_SHADOW_WGSL } from './directShadowWgsl.ts';
import { SUN_FAR_SHADOW_WGSL, SUN_FAR_STUB_WGSL } from './sunFarShadowWgsl.ts';

/**
 * Le socle des deux passes qui éclairent : les types du contrat, la lecture des ombres, et la
 * contribution d'une seule lampe déclarée au point, son ombre comprise — la seule formule
 * d'éclairement du moteur. Les deux boucles ci-dessous ne diffèrent que par la liste de lampes
 * qu'elles parcourent, jamais par la physique ni par le type de surface. Une lampe hors portée, ou
 * entièrement dans l'ombre, rend exactement zéro.
 *
 * `sunFar` est la seule chose que les deux passes ne partagent pas : l'ombre du soleil au-delà de
 * la dernière cascade se tire contre le proxy résident, et le proxy n'est lié qu'à la résolution
 * différée opaque. La passe de mélange reçoit le bouchon, qui rend un — le manque est nommé là où
 * il est écrit, pas deviné.
 */
const lightingBase = (sunFar: string) => `
${DIRECT_LIGHT_WGSL}
${sunFar}
${DIRECT_SHADOW_WGSL}
fn declaredLight(light:DirectLight,rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,P:vec3f,ao:f32)->vec3f{
 let incidence=directIncidence(light,P);
 if(incidence.w<=0.0){return vec3f(0.0);}
 let shade=shadowFactor(i32(light.params.y),light,P,N,incidence.xyz);
 if(shade<=0.0){return vec3f(0.0);}
 let energy=light.colorIntensity.w*incidence.w*shade;
 return standardLighting(rgb,metal,rough,N,V,vec4f(incidence.xyz,energy),vec3f(0.0),vec3f(0.0),ao)*light.colorIntensity.rgb;
}`;

/**
 * La résolution du contrat d'éclairage direct dans le visibility buffer. La boucle du pixel est
 * bornée par la liste de sa tuile, jamais par le nombre de lampes de la scène (X2) ; Lambert et GGX
 * viennent de `standardLighting`, la seule implémentation de référence ; l'atténuation est physique
 * et s'annule à la portée.
 *
 * Aucune lumière sans source déclarée (P6) : il n'y a ici ni terme ambiant, ni ciel constant, ni
 * éclairage écrit dans la scène. Une surface que nulle lampe déclarée n'atteint vaut exactement
 * zéro, et un couloir sans fenêtre reste noir en plein jour.
 */
export const DIRECT_LIGHTING_WGSL = `
${lightingBase(SUN_FAR_SHADOW_WGSL)}
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
  result+=declaredLight(directLights.items[tileLights[base+4u+index]],rgb,metal,rough,N,V,P,ao);
 }
 return result;
}`;

/**
 * Les lampes déclarées qui éclairent une surface de mélange, prises sur la **tranche de mélange** de
 * la liste de sa tuile : celle qui va du plan proche au fond opaque, et qui prend le tronc entier là
 * où nul opaque ne couvre la tuile. C'est la tranche qu'il faut, parce qu'une surface de mélange est
 * dessinée devant l'opaque de son pixel : la tranche des opaques lui retirerait des lampes
 * déclarées, et un feuillage posé devant le ciel n'en garderait aucune.
 *
 * La boucle reste **exacte**, et sa somme est celle de la boucle sur toutes les lampes, au bit près :
 * une lampe absente de la liste ne rencontre aucun point de la tranche — sa sphère de portée ne
 * touche pas la boîte monde —, donc `declaredLight` lui aurait rendu exactement `vec3f(0.0)`, et
 * retirer un zéro d'une somme de flottants ne la change pas. Ce qui change est le nombre de lampes
 * parcourues, donc le nombre de lectures d'atlas d'ombre.
 *
 * Sans liste — un appareil qui n'a pas pu gréer la passe de tuiles —, la boucle retombe sur les
 * lampes déclarées, bornée par `MAX_LIGHTS`, constante connue avant l'image (X2).
 */
export const DECLARED_LIGHTING_WGSL = `
${lightingBase(SUN_FAR_STUB_WGSL)}
fn declaredLighting(rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,P:vec3f,ao:f32,pixel:vec2f)->vec3f{
 var result=vec3f(0.0);
 let tilesX=u32(uni.lightTiles.x);
 let tilesY=u32(uni.lightTiles.y);
 let tile=vec2u(u32(pixel.x)/TILE_SIZE,u32(pixel.y)/TILE_SIZE);
 if(tilesX==0u||tilesY==0u||tile.x>=tilesX||tile.y>=tilesY){
  let count=min(directLights.count,MAX_LIGHTS);
  for(var index=0u;index<count;index++){
   result+=declaredLight(directLights.items[index],rgb,metal,rough,N,V,P,ao);
  }
  return result;
 }
 let base=(tile.y*tilesX+tile.x)*TILE_STRIDE;
 let kept=min(tileLights[base+2u],MAX_TILE_LIGHTS);
 for(var index=0u;index<kept;index++){
  result+=declaredLight(directLights.items[tileLights[base+TILE_BLEND_BASE+index]],rgb,metal,rough,N,V,P,ao);
 }
 return result;
}`;
