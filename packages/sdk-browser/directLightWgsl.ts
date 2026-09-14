import { LIGHT_SETTINGS, POINT_FACES } from '../sdk-core/index.ts';

/**
 * Les structures partagées par la passe de listes de lampes et par la résolution différée : une seule
 * déclaration du contrat `SceneLight` côté GPU, et une seule atténuation physique. Les bornes du
 * shader viennent des réglages publiés, jamais de constantes écrites à la main.
 */
export const DIRECT_LIGHT_WGSL = `
const TILE_SIZE:u32=${LIGHT_SETTINGS.tileSize}u;
const TILE_STRIDE:u32=${LIGHT_SETTINGS.maxLightsPerTile + 4}u;
const MAX_TILE_LIGHTS:u32=${LIGHT_SETTINGS.maxLightsPerTile}u;
const MAX_LIGHTS:u32=${LIGHT_SETTINGS.maxLights}u;
const POINT_FACES:u32=${POINT_FACES}u;
const SPOT_EDGE:f32=${LIGHT_SETTINGS.spotEdgeSoftness};
struct DirectLight{positionRange:vec4f,colorIntensity:vec4f,directionCone:vec4f,params:vec4f,}
struct DirectLights{count:u32,pad0:u32,pad1:u32,pad2:u32,items:array<DirectLight>,}
/** Direction normalisée vers la lampe et atténuation ; w à zéro quand le point est hors portée. */
fn directIncidence(light:DirectLight,P:vec3f)->vec4f{
 let offset=light.positionRange.xyz-P;
 let distance=length(offset);
 let range=light.positionRange.w;
 if(distance>=range){return vec4f(0.0);}
 let L=offset/max(distance,1e-6);
 // Carré inverse physique, fenêtré par la portée : l'énergie s'annule exactement à la portée.
 let ratio=distance/range;
 let window=pow(clamp(1.0-ratio*ratio*ratio*ratio,0.0,1.0),2.0);
 var attenuation=window/max(distance*distance,1e-4);
 if(light.params.x>0.5){
  let cosine=dot(-L,light.directionCone.xyz);
  let edge=light.directionCone.w;
  attenuation*=smoothstep(edge,edge+SPOT_EDGE,cosine);
 }
 return vec4f(L,attenuation);
}
/** L'axe majeur de la direction lampe vers le point, dans l'ordre de POINT_FACE_AXES. */
fn pointFaceOf(direction:vec3f)->u32{
 let a=abs(direction);
 if(a.x>=a.y&&a.x>=a.z){return select(1u,0u,direction.x>0.0);}
 if(a.y>=a.z){return select(3u,2u,direction.y>0.0);}
 return select(5u,4u,direction.z>0.0);
}`;
