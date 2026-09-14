import { LIGHT_SETTINGS, POINT_FACES } from '../sdk-core/index.ts';
import { DIRECT_LIGHT_WGSL } from './directLightWgsl.ts';

const POISSON_16 = [
  [-0.94201624, -0.39906216],
  [0.94558609, -0.76890725],
  [-0.094184101, -0.9293887],
  [0.34495938, 0.2938776],
  [-0.91588581, 0.45771432],
  [-0.81544232, -0.87912464],
  [-0.38277543, 0.27676845],
  [0.97484398, 0.75648379],
  [0.44323325, -0.97511554],
  [0.53742981, -0.4737342],
  [-0.26496911, -0.41893023],
  [0.79197514, 0.19090188],
  [-0.2418884, 0.99706507],
  [-0.81409955, 0.9143759],
  [0.19984126, 0.78641367],
  [0.14383161, -0.1410079],
];

/**
 * La lecture de l'atlas d'ombres : une tranche par lampe, six faces pour une ponctuelle, une pour un
 * projecteur ; comparaison de profondeur avec biais constant et biais par pente, puis moyenne de
 * seize prises. Les bornes viennent des réglages publiés — ni la tranche ni le noyau ne peuvent
 * déborder du rectangle de la face.
 */
const DIRECT_SHADOW_WGSL = `
struct ShadowFace{viewProjection:mat4x4f,rect:vec4f,}
struct ShadowSlice{faces:array<ShadowFace,${POINT_FACES}>,info:vec4f,}
struct ShadowSlices{items:array<ShadowSlice>,}
const PCF_TAPS:u32=${LIGHT_SETTINGS.pcfTaps}u;
const SHADOW_BIAS:f32=${LIGHT_SETTINGS.shadowDepthBias};
const SHADOW_SLOPE:f32=${LIGHT_SETTINGS.shadowSlopeBias};
const SHADOW_SLOPE_MAX:f32=${LIGHT_SETTINGS.shadowSlopeBiasMax};
const SHADOW_NORMAL_TEXELS:f32=${LIGHT_SETTINGS.shadowNormalOffsetTexels};
const POISSON:array<vec2f,${LIGHT_SETTINGS.pcfTaps}>=array<vec2f,${LIGHT_SETTINGS.pcfTaps}>(${POISSON_16.map(
  ([x, y]) => `vec2f(${x},${y})`,
).join(',')});
/** Fraction de lumiere qui atteint le point : 1 en pleine lumiere, 0 entierement dans l'ombre. */
fn shadowFactor(slice:i32,light:DirectLight,P:vec3f,N:vec3f,L:vec3f)->f32{
 if(slice<0){return 1.0;}
 let record=shadows.items[u32(slice)];
 let faces=u32(record.info.x);
 if(faces==0u){return 1.0;}
 let face=select(0u,pointFaceOf(P-light.positionRange.xyz),faces==POINT_FACES);
 let entry=record.faces[face];
 if(entry.rect.w<0.5){return 1.0;}
 // Le point lu est décalé le long de la normale d'un texel de la tranche, divisé par le cosinus
 // d'incidence : un texel couvre d'autant plus de profondeur que la surface est rasante. C'est ce
 // décalage qui referme la couture entre deux faces d'une ponctuelle et supprime l'acné rasante.
 let cosine=clamp(dot(N,L),1e-3,1.0);
 let radius=length(light.positionRange.xyz-P);
 let texel=2.0*record.info.y*radius/max(record.info.z,1.0);
 let clip=entry.viewProjection*vec4f(P+N*texel*SHADOW_NORMAL_TEXELS/max(cosine,0.2),1.0);
 if(clip.w<=0.0){return 1.0;}
 let ndc=clip.xyz/clip.w;
 if(abs(ndc.x)>1.0||abs(ndc.y)>1.0||ndc.z<0.0||ndc.z>1.0){return 1.0;}
 let local=vec2f(ndc.x*0.5+0.5,0.5-ndc.y*0.5);
 // Biais par pente : une surface rasante a besoin de plus de marge qu'une surface de face.
 let metres=SHADOW_BIAS+min(SHADOW_SLOPE*sqrt(1.0-cosine*cosine)/cosine,SHADOW_SLOPE_MAX);
 // Ces mètres deviennent une marge de profondeur au point considéré : dz/dd d'une projection
 // perspective vaut near·far/((far−near)·d²), donc la marge suit la distance à la lampe.
 let near=record.info.w;
 let far=max(near*1.001,light.positionRange.w);
 let scale=near*far/((far-near)*max(clip.w*clip.w,1e-4));
 let reference=ndc.z-metres*scale;
 // Une prise décalée d'un texel de la tranche, jamais d'un texel d'atlas : le noyau suit la tranche.
 let step=1.0/max(record.info.z,1.0);
 var lit=0.0;
 for(var tap=0u;tap<PCF_TAPS;tap++){
  let offset=POISSON[tap]*step;
  let inside=clamp(local+offset,vec2f(0.0),vec2f(1.0));
  let uv=entry.rect.xy+inside*entry.rect.z;
  lit+=textureSampleCompareLevel(shadowAtlas,shadowSampler,uv,reference);
 }
 return lit/f32(PCF_TAPS);
}`;

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
