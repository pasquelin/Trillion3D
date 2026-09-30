import { SCREEN_REFLECTION_WGSL } from '../../reflections/screenWgsl.ts';
import { declaredLightingWgsl } from '../../lighting/direct/lightingWgsl.ts';
import * as surfaceModel from '../../scene/surfaceModel.ts';
import { ROUGHNESS_FLOOR } from '../../lighting/shaderConstants.ts';
import { bounceApplyWgsl } from '../../bounce/applyWgsl.ts';
import { bounceReflectionWgsl, MIRROR_LIGHTING_WGSL } from '../../bounce/reflectWgsl.ts';
import { STANDARD_LIGHTING_WGSL, NORMAL_TRANSFORM_WGSL } from '../../lighting/standardLighting.ts';
import { TRIANGLE_PALETTE_WGSL } from '../../diagnostic/trianglePalette.ts';
import {
  COLOR_SAMPLE_WGSL,
  DATA_SAMPLE_WGSL,
  TILE_POOL_WGSL,
  tileDeclarations,
} from '../tile/wgsl.ts';
import { TILE_REQUEST_WGSL } from '../tile/requestWgsl.ts';
import { BLEND_BINDINGS } from '../core/bindLayout.ts';
import { BLEND_ITEM_WGSL } from './items.ts';
import { BLEND_REQUEST_WGSL } from './requestWgsl.ts';
import { FLAG_HAS_COLOR, FLAG_PAGED, FLAG_UNLIT_VIEW } from '../../visibility/buffer.ts';
import { PAGE_INFO_STRUCT_WGSL, VERT_NORMAL_WGSL } from '../../visibility/shader/pageWgsl.ts';
import { PAGE_GEOMETRY_WGSL, PAGE_NORMAL_WGSL } from '../../visibility/shader/pageGeometryWgsl.ts';
import { BLEND_SURFACE_WGSL } from './shaderSurface.ts';
import { LINE_CLIP_WGSL } from '../../visibility/shader/lineWgsl.ts';
import { SPRITE_WGSL } from '../../visibility/shader/spriteWgsl.ts';
import { WATER_MAX_ITEMS, WATER_RANK_SHIFT } from '../water/surfaceWgsl.ts';
import { INSTANCE_CULL_SHIFT, INSTANCE_ITEM_MASK } from './runs.ts';
import { FACING_DROP, FACING_SHIFT, FACING_WGSL } from './facing.ts';
import { DISPLAY_ROUTE_WGSL, displayMaskWgsl } from './displayFilter.ts';
/** The pass's view uniform (`uniforms.ts`), the water composite's too (`displayFilter.ts`). */
export const BLEND_VIEW_WGSL = `struct BlendView{viewProj:mat4x4f,camPos:vec4f,lightTiles:vec2f,viewFlags:u32,vertexShift:u32,feedback:u32,pixelScale:f32,viewport:vec2f,eye:vec4f,pixelRatio:f32,mipBias:f32,exposure:f32,toneCurve:u32,}`;
export const blendShader = (pages?: number) => `${BLEND_VIEW_WGSL}
${BLEND_ITEM_WGSL}
@group(0) @binding(${BLEND_BINDINGS.indices}) var<storage, read> indices:array<u32>;
@group(0) @binding(${BLEND_BINDINGS.positions}) var<storage, read> positions:array<f32>;
@group(0) @binding(${BLEND_BINDINGS.uvs}) var<storage, read> uvs:array<f32>;
@group(0) @binding(${BLEND_BINDINGS.uniform}) var<uniform> uni:BlendView;
@group(0) @binding(${BLEND_BINDINGS.items}) var<storage,read> items:array<BlendItem>;
${tileDeclarations(BLEND_BINDINGS.color, 'color')}
@group(0) @binding(${BLEND_BINDINGS.sampler}) var mapsSampler:sampler;
${tileDeclarations(BLEND_BINDINGS.data, 'data')}
@group(0) @binding(${BLEND_BINDINGS.normals}) var<storage,read> normals:array<f32>;
${PAGE_INFO_STRUCT_WGSL}
${PAGE_GEOMETRY_WGSL}
${VERT_NORMAL_WGSL}
${PAGE_NORMAL_WGSL}
${STANDARD_LIGHTING_WGSL}
${declaredLightingWgsl(BLEND_BINDINGS.proxy, BLEND_BINDINGS.shadowData, BLEND_BINDINGS.shadowTransmittance, pages)}
${bounceApplyWgsl(BLEND_BINDINGS.bounceGrid, BLEND_BINDINGS.probes)}
${bounceReflectionWgsl(BLEND_BINDINGS.surfaceCache)}
${MIRROR_LIGHTING_WGSL.replace(')*reflectedRadiance(', ')*resolvedRadiance(')}
${SCREEN_REFLECTION_WGSL}
@group(0) @binding(${BLEND_BINDINGS.directLights}) var<storage,read> directLights:DirectLights;
@group(0) @binding(${BLEND_BINDINGS.shadowAtlas}) var shadowAtlas:texture_depth_2d_array;
@group(0) @binding(${BLEND_BINDINGS.shadowSampler}) var shadowSampler:sampler_comparison;
@group(0) @binding(${BLEND_BINDINGS.clusterDiagnostic}) var<storage,read> clusterDiagnostic:array<u32>;
@group(0) @binding(${BLEND_BINDINGS.planInstances}) var<storage,read> planInstances:array<vec2u>;
@group(0) @binding(${BLEND_BINDINGS.clusterSpans}) var<storage,read> clusterSpans:array<vec4u>;
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
${NORMAL_TRANSFORM_WGSL}
${LINE_CLIP_WGSL}
${SPRITE_WGSL}
// What the vertex stage reads on the item record and the fragment stage re-reads as-is: the six
// maps, their factors and the flags, constant over the call, therefore FLAT (no per-call binding).
// \`water\` is the item's one-based transmissive rank, carried above its flags, zero for a blend;
// above it, the cull mode a doubtful triangle leaves to the fragment stage (facing.ts).
// \`alphaAo\` carries, after the alpha test and the occlusion strength, a dashed line's dash and gap.
struct VSOut{@builtin(position) position:vec4f,@location(0) color:vec4f,@location(1) uv:vec2f,@location(2) view:vec3f,@location(3) normal:vec4f,@location(4) tangent:vec4f,@location(5) bitangent:vec4f,@location(6) @interpolate(flat) tri:u32,@location(7) bary:vec3f,@location(8) @interpolate(flat) diagId:u32,@location(9) @interpolate(flat) ids:vec3u,@location(10) @interpolate(flat) maps:vec4u,@location(11) @interpolate(flat) alphaAo:vec4f,@location(12) @interpolate(flat) pbr:vec4f,@location(13) @interpolate(flat) emissive:vec4f,@location(14) @interpolate(flat) water:u32,}
${TRIANGLE_PALETTE_WGSL}
// An instance draws a paged cluster compaction kept, or a piece of indices of an unpaged primitive,
// as the list plan expansion wrote it (expandWgsl.ts), both read through \`pageGeometryWgsl.ts\`.
// The rank of the first instance of the call is read in the high bits of the vertex index, and
// the local rank of the vertex in the low: the indirect argument of a slice starts at vertex
// base << vertexShift. That is what lets a whole slice fit in ONE call, with nothing to bind
// between two plan entries — firstInstance would say the same, but WebGPU only opens it to an
// indirect call under an extension.
${FACING_WGSL}
@vertex fn vs(@builtin(vertex_index) vertexIndex:u32,@builtin(instance_index) instance:u32)->VSOut{
 var out:VSOut;
 let slot=planInstances[(vertexIndex>>uni.vertexShift)+instance];
 let it=items[slot.x&${INSTANCE_ITEM_MASK}u];
 let cull=slot.x>>${INSTANCE_CULL_SHIFT}u;
 let local=vertexIndex&((1u<<uni.vertexShift)-1u);
 let flags=(it.flags&${WATER_MAX_ITEMS}u)|uni.viewFlags;
 out.color=it.color;
 out.ids=vec3u(it.mapIndex,flags|(u32(it.emissive.w)<<${surfaceModel.MODEL_SHIFT}u),it.emissiveIndex);
 out.maps=vec4u(it.roughIndex,it.metalIndex,it.normalIndex,it.aoIndex);
 out.alphaAo=vec4f(it.alphaTest,it.aoIntensity,it.dash);
 out.pbr=vec4f(it.roughness,it.metalness,it.normalScale);
 out.emissive=vec4f(it.emissive.xyz,it.subsurface.w);
 out.normal.w=it.subsurface.x;out.tangent.w=it.subsurface.y;out.bitangent.w=it.subsurface.z;
 var page:PageInfo;
 page.flags=flags;page.vertexBase=it.vertexBase;page.pageOffset=slot.y;page.deform=it.deform;page.packedBase=it.deformInput;page.deformOutput=it.deformOutput;
 var count=it.indexCount-slot.y;
 var clusterId=0u;
 if((flags&${FLAG_PAGED}u)!=0u){
  let span=clusterSpans[slot.y];
  page.pageOffset=span.x;page.deformOutput=span.z;page.deformCount=span.w;
  count=span.y;
  clusterId=clusterDiagnostic[slot.y];
 }
 // A padding lane past the cluster's corners reads nothing, not even the page header.
 var h:ClusterHeader;
 var corners=vec3u(0u);var facing=0u;
 if(local<count){
  h=pageHeader(page);
  corners=pageTriangle(page,h,local/3u);
  if(cull!=0u){facing=vertexFacing(cull,it.world,page,h,corners);}
 }
 out.water=(it.flags>>${WATER_RANK_SHIFT}u)|(facing<<${FACING_SHIFT}u);
 if(local>=count||facing==${FACING_DROP}u){out.position=vec4f(0.0,0.0,2.0,1.0);out.color=vec4f(0.0);out.uv=vec2f(0.0);out.view=vec3f(0.0);out.normal.xyz=vec3f(0.0,0.0,1.0);out.tangent.xyz=vec3f(0.0);out.bitangent.xyz=vec3f(0.0);out.tri=0u;out.bary=vec3f(0.0);out.diagId=0u;return out;}
 let v=corners[local%3u];
 // The material colour times the vertex colour, alpha included, as the forward path reads it.
 if((flags&${FLAG_HAS_COLOR}u)!=0u){out.color*=pageColor(page,h,v);}
 let p=pagePosition(page,h,v);
 let world=it.world*vec4f(p,1.0);
 out.position=uni.viewProj*world;out.view=world.xyz;
 // A line quad widens on screen (\`lineClip\`), along the direction its corner's normal carries.
 if(it.lineWidth>0.0){out.position=lineClip(out.position,uni.viewProj*(it.world*vec4f(pageNormal(page,h,v),0.0)),it.lineWidth,uni.viewport,uni.pixelRatio);}
 // A sprite's quad turns to face the camera (\`spriteAt\`), about its origin.
 if(it.sprite.y!=0.0){let s=spriteAt(uni.viewProj,it.world,p.xy,it.sprite);out.position=uni.viewProj*s;out.view=s.xyz;}
 out.tri=0u;
 out.diagId=0u;
 if((flags&0x1c000000u)!=0u){out.diagId=clusterId;}
 if((flags&0x20000000u)!=0u){
  let a=triangleHash(corners.x);let b=triangleHash(corners.y);let c=triangleHash(corners.z);
  out.tri=a^((b<<1u)|(b>>31u))^((c<<2u)|(c>>30u));
 }
 let corner=local%3u;
 out.bary=select(select(vec3f(0.0,0.0,1.0),vec3f(0.0,1.0,0.0),corner==1u),vec3f(1.0,0.0,0.0),corner==0u);
 out.normal.xyz=vec3f(0.0);
 if((flags&16u)!=0u){out.normal.xyz=xformNormal(it.world,pageNormal(page,h,v));}
 out.tangent.xyz=vec3f(0.0);out.bitangent.xyz=vec3f(0.0);
 if((flags&256u)!=0u){out.normal.xyz=-out.normal.xyz;}
 // A page stores no tangent: an item that reads one reads it as floats, and a quantized one never
 // carries the flag (\`prepare.ts\`), its frame rebuilt from the screen (\`shaderSurface.ts\`).
 if((flags&2048u)!=0u){
  let t=vertT(page.vertexBase,v);
  out.tangent.xyz=uniteOuZero((it.world*vec4f(t.xyz,0.0)).xyz);
  if((flags&256u)!=0u){out.tangent.xyz=-out.tangent.xyz;}
  out.bitangent.xyz=uniteOuZero(cross(out.normal.xyz,out.tangent.xyz)*t.w);
 }
 out.uv=pageUv(page,h,v);
 return out;
}
${BLEND_SURFACE_WGSL}
fn blendFragment(in:VSOut,front:bool,masked:f32)->BlendOut{
 let flags=in.ids.y;
 // \`fwidth\` wants uniform control flow: taken before any condition on the item's flags.
 let width=fwidth(in.bary);
 let s=blendSurface(in,front);
 // A dashed line's gap (\`lineDash\`): its distance along the line rides the first coordinate.
 if(!lineDash(in.uv.x,in.alphaAo.zw)){discard;}
 if((flags&0x40000000u)!=0u){
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
 // No declared lamp, or an unlit view requested: the raw albedo, exactly like the opaque
 // resolve. Neither ambient, nor sky, nor a default sun (P6).
 let unlit=(flags&${FLAG_UNLIT_VIEW}u)!=0u;
 let V=normalize(uni.camPos.xyz-in.view*uni.camPos.w);
 let clamped=clamp(s.rough,${ROUGHNESS_FLOOR},1.0);
 if(!unlit){
  if((flags&1u)!=0u){
   let m=clamp(s.metal,0.0,1.0);
   let model=(flags>>${surfaceModel.MODEL_SHIFT}u)&7u;
   surfaceModel=select(select(0u,${surfaceModel.MODEL_FLAG.diffuse}u,model==${surfaceModel.SURFACE_MODEL.diffuse}u),${surfaceModel.MODEL_FLAG.toon}u,model==${surfaceModel.SURFACE_MODEL.toon}u);
   thinSubsurface=s.subsurface;
   shadowFootprint=select(uni.pixelScale,uni.pixelScale*length(uni.camPos.xyz-in.view),uni.camPos.w!=0.0);
   rgb=declaredLighting(rgb,m,clamped,s.N,V,in.view,s.ao,in.position.xy)+bounceLighting(rgb,m,s.N,in.view,s.ao)+environmentLighting(rgb,m,s.N,s.ao)+s.emissive;
   if(any(thinSubsurface>vec3f(0.0))){rgb+=bounceLighting(thinSubsurface,0.0,-s.N,in.view,s.ao)+environmentLighting(thinSubsurface,0.0,-s.N,s.ao);}
   rgb+=mirrorLighting(s.rgb,m,clamped,s.N,V,in.view);
  }
  // Lit or unlit, the surface is seen through the fog.
  if((flags&${surfaceModel.FOG_FREE_MODEL_BIT << surfaceModel.MODEL_SHIFT}u)==0u){rgb=fogged(rgb,in.view,uni.eye.xyz);}
 }
 let r=displayRoute(rgb,uni.exposure,uni.toneCurve,unlit,s.alpha,masked);
 return BlendOut(vec4f(rgb,s.alpha*r.keep),s.request,vec4f(0.0,1.0,0.0,s.alpha*r.keep),r.tint,r.add);
}
// A filtered image's pipelines read the display mask (group 2); every other one reads none.
@fragment fn fs(in:VSOut,@builtin(front_facing) front:bool)->BlendOut{return blendFragment(in,front,0.0);}
@fragment fn fsFiltered(in:VSOut,@builtin(front_facing) front:bool)->BlendOut{return blendFragment(in,front,maskAt(in.position));}
`;
export const BLEND_SHADER = blendShader();
