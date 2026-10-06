import { TRANSLUCENT_SCREEN_REFLECTION_WGSL } from '../../reflections/screenWgsl.ts'
import { declaredLightingWgsl } from '../../lighting/direct/lightingWgsl.ts'
import { shadowKindsOf } from '../../lighting/direct/shadowKinds.ts'
import * as surfaceModel from '../../scene/surfaceModel.ts'
import { ROUGHNESS_FLOOR } from '../../lighting/shaderConstants.ts'
import { bounceApplyWgsl } from '../../bounce/applyWgsl.ts'
import { bounceReflectionWgsl, MIRROR_LIGHTING_WGSL } from '../../bounce/reflectWgsl.ts'
import { STANDARD_LIGHTING_WGSL } from '../../lighting/standardLighting.ts'
import {
  COLOR_SAMPLE_WGSL,
  DATA_SAMPLE_WGSL,
  TILE_POOL_WGSL,
  tileDeclarations,
} from '../tile/wgsl.ts'
import { TILE_REQUEST_WGSL } from '../tile/requestWgsl.ts'
import { BLEND_BINDINGS, BLEND_VSM_BINDINGS } from '../core/bindLayout.ts'
import { BLEND_REQUEST_WGSL } from './requestWgsl.ts'
import * as itemFlags from '../../visibility/buffer.ts'
import { BLEND_SURFACE_WGSL } from './shaderSurface.ts'
import { DISPLAY_ROUTE_WGSL, displayMaskWgsl } from './displayFilter.ts'
import { BLEND_VERTEX_WGSL } from './vertexWgsl.ts'
import type { ContractKey } from '../../lighting/deferred/contractVariants.ts'
export { BLEND_VIEW_WGSL } from './vertexWgsl.ts'
/** The blend module; its light loop without the shadow or the rectangle code `key` leaves out
 *  (`declaredLightingWgsl`), the program of a scene that holds none (`pipelines.ts`). */
export const blendShader = (key: Partial<ContractKey> = {}) => `${BLEND_VERTEX_WGSL}
${tileDeclarations(BLEND_BINDINGS.color, 'color')}
@group(0) @binding(${BLEND_BINDINGS.sampler}) var mapsSampler:sampler;
${tileDeclarations(BLEND_BINDINGS.data, 'data')}
${STANDARD_LIGHTING_WGSL}
${declaredLightingWgsl(BLEND_BINDINGS.proxy, BLEND_BINDINGS.shadowTransmittance, BLEND_VSM_BINDINGS, false, !key.unshadowed, !key.rectless, shadowKindsOf(key))}
${bounceApplyWgsl(BLEND_BINDINGS.bounceGrid, BLEND_BINDINGS.probes)}
${bounceReflectionWgsl(BLEND_BINDINGS.surfaceCache)}
${MIRROR_LIGHTING_WGSL.replace(')*reflectedRadiance(', ')*resolvedRadiance(')}
${TRANSLUCENT_SCREEN_REFLECTION_WGSL}
fn translucentReflectionFrame()->f32{return uni.frameNoise;}
@group(0) @binding(${BLEND_BINDINGS.directLights}) var<storage,read> directLights:DirectLights;
@group(0) @binding(${BLEND_BINDINGS.tileLights}) var<storage,read> tileLights:array<u32>;
${TILE_POOL_WGSL}
${COLOR_SAMPLE_WGSL}
${DATA_SAMPLE_WGSL}
${TILE_REQUEST_WGSL}
// The blended colour, the tile rank this pixel asks of the virtual textures, in its own target
// (no memory write: early reject kept), the as-is share and the display layers (\`displayFilter.ts\`).
struct BlendOut{@location(0) color:vec4f,@location(1) request:u32,@location(2) asIs:vec4f,@location(3) tint:vec4f,@location(4) add:vec4f,}
${BLEND_REQUEST_WGSL}
${DISPLAY_ROUTE_WGSL}${displayMaskWgsl(2)}
${BLEND_SURFACE_WGSL}
fn blendFragment(in:VSOut,front:bool,masked:f32)->BlendOut{
 let flags=in.ids.y;
 // Every derivative wants uniform control flow: taken before the coverage test returns.
 let width=fwidth(in.bary);
 let g=blendGrads(in);
 let base=blendBase(in,g);
 // A fragment the material rejects (\`blendKeeps\`), or a dashed line's gap (\`lineDash\`: its
 // distance along the line rides the first coordinate), reads and lights nothing more.
 if(!blendKeeps(in,base,front)||!lineDash(in.uv.x,in.alphaAo.zw)){discard;return BlendOut(vec4f(0.0),0u,vec4f(0.0),vec4f(0.0),vec4f(0.0));}
 let s=blendSurface(in,front,g,base);
 if((flags&${itemFlags.FLAG_DIAGNOSTIC_VIEW}u)!=0u){
  if(s.alpha<=0.01){discard;}
  var color=vec3f(0.204,0.827,0.6);
  if((flags&0x20000000u)!=0u){
   let edge=1.0-min(min(smoothstep(0.0,width.x*1.2,in.bary.x),smoothstep(0.0,width.y*1.2,in.bary.y)),smoothstep(0.0,width.z*1.2,in.bary.z));
   color=mix(hashColor(in.tri),vec3f(0.04,0.05,0.07),edge);
  }else if((flags&0x10000000u)!=0u){color=select(vec3f(0.5,0.55,0.6),hashColor(in.diagId&0x00ffffffu),in.diagId!=0u);}
  else if((flags&0x08000000u)!=0u){color=select(vec3f(0.04,0.51,0.94),vec3f(0.95,0.42,0.05),(in.diagId&0x80000000u)!=0u);}
  else if((flags&0x04000000u)!=0u){let ratio=f32((in.diagId>>24u)&127u)/127.0;color=vec3f(ratio,1.0-ratio,0.12);}
  return BlendOut(vec4f(color,1.0),s.request,vec4f(0.0,1.0,0.0,1.0),vec4f(1.0),vec4f(0.0));
 }
 var rgb=s.rgb;
 // No declared lamp, or an unlit view requested: the raw albedo and its emission, exactly like
 // the opaque resolve. Neither ambient, nor sky, nor a default sun (P6).
 let unlit=(flags&${itemFlags.FLAG_UNLIT_VIEW}u)!=0u;
 let V=normalize(uni.camPos.xyz-in.view*uni.camPos.w);
 let clamped=clamp(s.rough,${ROUGHNESS_FLOOR},1.0);
 if(!unlit){
  if((flags&1u)!=0u){
   let m=clamp(s.metal,0.0,1.0);
   let model=(flags>>${surfaceModel.MODEL_SHIFT}u)&7u;
   surfaceModel=select(select(0u,${surfaceModel.MODEL_FLAG.diffuse}u,model==${surfaceModel.SURFACE_MODEL.diffuse}u),${surfaceModel.MODEL_FLAG.toon}u,model==${surfaceModel.SURFACE_MODEL.toon}u);
   thinSubsurface=s.subsurface;
   shadowFootprint=blendShadowFootprint(in.view);
   shadowSetView(uni.camPos.xyz,uni.viewport.x,in.position.xy,0u,shadowFootprint,in.view);
   rgb=declaredLighting(rgb,m,clamped,s.N,V,in.view,s.ao,in.position.xy,in.position.z)+bounceLighting(rgb,m,s.N,in.view,s.ao)+environmentLighting(rgb,m,s.N,s.ao)+s.emissive;
   if(any(thinSubsurface>vec3f(0.0))){rgb+=bounceLighting(thinSubsurface,0.0,-s.N,in.view,s.ao)+environmentLighting(thinSubsurface,0.0,-s.N,s.ao);}
   rgb+=mirrorLighting(s.rgb,m,clamped,s.N,V,in.view);
  }
  // Lit, the surface is seen through the fog; unlit, it keeps what it emits.
  if((flags&${surfaceModel.FOG_FREE_MODEL_BIT << surfaceModel.MODEL_SHIFT}u)==0u){rgb=fogged(rgb,in.view,uni.eye.xyz);}
 }else{rgb+=s.emissive;}
 let r=displayRoute(rgb,uni.exposure,uni.toneCurve,unlit,s.alpha,masked);
 return BlendOut(vec4f(rgb,s.alpha*r.keep),s.request,vec4f(0.0,1.0,0.0,s.alpha*r.keep),r.tint,r.add);
}
// A filtered image's pipelines read the display mask (group 2); every other one reads none.
@fragment fn fs(in:VSOut,@builtin(front_facing) front:bool)->BlendOut{return blendFragment(in,front,0.0);}
@fragment fn fsFiltered(in:VSOut,@builtin(front_facing) front:bool)->BlendOut{return blendFragment(in,front,maskAt(in.position));}
`
