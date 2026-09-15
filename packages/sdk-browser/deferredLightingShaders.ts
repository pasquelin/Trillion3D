import { STANDARD_LIGHTING_WGSL } from './standardLighting.ts';
import { DIRECT_LIGHTING_WGSL } from './directLightingWgsl.ts';

export const FULLSCREEN_VERTEX = `@vertex fn fullscreen(@builtin(vertex_index) i:u32)->@builtin(position) vec4f{return vec4f(f32(i32(i&1u)*4-1),f32(i32(i>>1u)*4-1),0.0,1.0);}`;
const OUTPUT_COLOR_WGSL = `
fn aces(color:vec3f)->vec3f{
 var c=color/0.6;
 c=mat3x3f(vec3f(0.59719,0.07600,0.02840),vec3f(0.35458,0.90834,0.13383),vec3f(0.04823,0.01566,0.83777))*c;
 let a=c*(c+0.0245786)-0.000090537;let b=c*(0.983729*c+0.4329510)+0.238081;c=a/b;
 c=mat3x3f(vec3f(1.60475,-0.10208,-0.00327),vec3f(-0.53108,1.10813,-0.07276),vec3f(-0.07367,-0.00605,1.07602))*c;
 return clamp(c,vec3f(0.0),vec3f(1.0));
}
fn linearToSrgb(c:vec3f)->vec3f{return select(1.055*pow(max(c,vec3f(0.0)),vec3f(0.41666))-0.055,c*12.92,c<vec3f(0.0031308));}`;
/** L'uniforme de vue, commun aux deux programmes : `lightParams` porte le nombre de lampes du
 *  contrat et les tuiles en X et en Y ; `sky.w` porte l'exposition, appliquée avant ACES (P4). */
const VIEW_WGSL = `struct View{inverseViewProjection:mat4x4f,camera:vec4f,viewport:vec4f,background:vec4f,lightParams:vec4f,sky:vec4f,}`;
const SURFACE_BINDINGS_WGSL = `
@group(0) @binding(0) var baseMetal:texture_2d<f32>;
@group(0) @binding(1) var normalRough:texture_2d<f32>;
@group(0) @binding(2) var emissiveAo:texture_2d<f32>;
@group(0) @binding(3) var flags:texture_2d<u32>;
@group(0) @binding(4) var depth:texture_depth_2d;
@group(0) @binding(5) var<uniform> view:View;`;
/**
 * La vue sans éclairage : l'albédo des matériaux tel quel, sans lampe, sans ambiance et sans
 * émission. Ce n'est pas une lumière, c'est une vue de diagnostic — celle que demandent les bancs
 * de géométrie qui comparent des images au pixel près, et celle que le moteur rend par défaut tant
 * qu'aucune lampe n'est déclarée, parce qu'une scène sans source n'a rien à éclairer (P6).
 */
export const UNLIT_LIGHTING_SHADER = `
${VIEW_WGSL}
${SURFACE_BINDINGS_WGSL}
${FULLSCREEN_VERTEX}
@fragment fn lightSurface(@builtin(position) pixel:vec4f)->@location(0) vec4f{
 let coord=vec2i(pixel.xy);let flag=textureLoad(flags,coord,0).r;
 if(flag==0u){return vec4f(0.0);}
 return vec4f(textureLoad(baseMetal,coord,0).rgb,1.0);
}`;
/**
 * Le programme du contrat : le rassemblement différé éclairé par les seules lampes déclarées, avec
 * leurs ombres. Aucun terme ambiant, aucun ciel constant, aucune lumière écrite dans la scène ne
 * s'y ajoute (P6). Les surfaces marquées non éclairées ou en espace d'affichage sortent telles
 * quelles, comme avant : ce sont des matériaux sans réponse à la lumière, pas des surfaces éclairées.
 */
export const DIRECT_LIGHTING_SHADER = `
${VIEW_WGSL}
${SURFACE_BINDINGS_WGSL}
@group(0) @binding(6) var<storage,read> directLights:DirectLights;
@group(0) @binding(7) var<storage,read> tileLights:array<u32>;
@group(0) @binding(8) var<storage,read> shadows:ShadowSlices;
@group(0) @binding(9) var shadowAtlas:texture_depth_2d;
@group(0) @binding(10) var shadowSampler:sampler_comparison;
${STANDARD_LIGHTING_WGSL}
${DIRECT_LIGHTING_WGSL}
${FULLSCREEN_VERTEX}
@fragment fn lightSurface(@builtin(position) pixel:vec4f)->@location(0) vec4f{
 let coord=vec2i(pixel.xy);let flag=textureLoad(flags,coord,0).r;
 if(flag==0u){return vec4f(0.0);}
 let base=textureLoad(baseMetal,coord,0);
 if(flag==1u||flag==3u){return vec4f(base.rgb,1.0);}
 let normal=textureLoad(normalRough,coord,0);let emissive=textureLoad(emissiveAo,coord,0);
 let z=textureLoad(depth,coord,0);
 let ndc=vec4f(pixel.x/view.viewport.x*2.0-1.0,1.0-pixel.y/view.viewport.y*2.0,z,1.0);
 let world=view.inverseViewProjection*ndc;let P=world.xyz/world.w;
 let V=normalize(view.camera.xyz-P);let N=normalize(normal.xyz);
 let lit=contractLighting(base.rgb,base.a,normal.a,N,V,P,emissive.a,pixel.xy);
 return vec4f(lit+emissive.rgb,1.0);
}`;
/** La composition : l'exposition multiplie la radiance linéaire avant ACES, dernier maillon (P4). */
const COMPOSE_BODY = `
${FULLSCREEN_VERTEX}
${OUTPUT_COLOR_WGSL}
fn composeColor(pixel:vec4f)->vec4f{
 let value=textureLoad(hdr,vec2i(pixel.xy),0);
 if(value.a==0.0){return view.background;}
 if(view.viewport.z!=0.0){return vec4f(value.rgb,1.0);}
 let color=linearToSrgb(aces(value.rgb*view.sky.w/max(value.a,1e-6)));
 return vec4f(color*value.a+view.background.rgb*(1.0-value.a),1.0);
}
@fragment fn compose(@builtin(position) pixel:vec4f)->@location(0) vec4f{return composeColor(pixel);}
struct DisplayOutput{@location(0) capture:vec4f,@location(1) canvas:vec4f,}
@fragment fn composePresent(@builtin(position) pixel:vec4f)->DisplayOutput{
 let color=composeColor(pixel);
 return DisplayOutput(color,color);
}`;
export const COMPOSE_SHADER = `
${VIEW_WGSL}
@group(0) @binding(0) var hdr:texture_2d<f32>;
@group(0) @binding(1) var<uniform> view:View;
${COMPOSE_BODY}`;
