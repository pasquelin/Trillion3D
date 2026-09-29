import { VIEW_WGSL, WORLD_AT_WGSL } from '../../lighting/deferred/shaders.ts';
import { DIRECT_LIGHT_WGSL } from '../../lighting/direct/lightWgsl.ts';
import { TILE_SLICE_WGSL } from '../../lighting/direct/lightingWgsl.ts';
import { SHADOW_READ_AT_WGSL } from '../../lighting/direct/shadowFactorWgsl.ts';
import { shadowRequestWgsl } from '../../lighting/direct/shadowRequestWgsl.ts';
import { SHADOW_DATA_WGSL, SHADOW_PAGE_READ_WGSL } from '../../lighting/direct/shadowWgsl.ts';
import { AS_IS_FLAG, FOG_FREE_SURFACE_FLAG } from '../../scene/surfaceModel.ts';

/** Pixels a side of a workgroup of the demand pass. */
export const SHADOW_DEMAND_GROUP = 8;

/**
 * THE PER-PIXEL DEMAND OF SHADOW PAGES (#1275): one invocation per pixel of the visibility buffer,
 * after depth and before any shadow page is drawn or read. A pixel the resolve lights marks, for
 * every shadowed light of its tile's opaque list, the pages that light's read wants at it — the
 * sun level or the lamp mip of its footprint, its home page and the neighbours the PCF reaches
 * across a page edge — in the request buffer the resolve records into (`requestShadowPage`).
 *
 * Every step is the shading's own: the view and the world point its resolve reconstructs
 * (`WORLD_AT_WGSL`, the deferred pass's view uniform), its tile slice, its light gate, and the page
 * model (`pageModel.ts`) its read takes the level, the map texel, the entry and the PCF's pages
 * from. Unlike the read, the demand never falls back: a page not drawn yet is the one it wants.
 */
export const SHADOW_DEMAND_WGSL = `
${VIEW_WGSL}
@group(0) @binding(0) var depth:texture_depth_2d;
@group(0) @binding(1) var normalRough:texture_2d<f32>;
@group(0) @binding(2) var flags:texture_2d<u32>;
@group(0) @binding(3) var<uniform> view:View;
@group(0) @binding(4) var<storage,read> directLights:DirectLights;
@group(0) @binding(5) var<storage,read> tileLights:array<u32>;
${SHADOW_DATA_WGSL}
@group(0) @binding(6) var<storage,read> shadows:ShadowData;
${shadowRequestWgsl(7)}
${DIRECT_LIGHT_WGSL}
${TILE_SLICE_WGSL}
${SHADOW_PAGE_READ_WGSL}
${SHADOW_READ_AT_WGSL}
${WORLD_AT_WGSL}
/** Marks page \`p\` of the map: nothing outside a ring's window. */
fn demandPage(m:ShadowMap,p:vec2i){let e=shadowPageEntry(m,p);if(e>=0){requestShadowPage(u32(e));}}
/** Marks the home page of map texel \`t\` and the neighbours the PCF reads around it
 *  (\`shadowPcf\`): across the one or two edges it comes near. */
fn demandPages(m:ShadowMap,t:vec2f,home:vec2i){
 let first=vec2f(home)*SHADOW_PAGE;
 let edge=vec2i(shadowPcfEdge(t.x,first.x),shadowPcfEdge(t.y,first.y))>vec2i(0);
 let step=vec2i(shadowPcfStep(t.x,first.x),shadowPcfStep(t.y,first.y));
 demandPage(m,home);
 if(edge.x){demandPage(m,home+vec2i(step.x,0));}
 if(edge.y){demandPage(m,home+vec2i(0,step.y));}
 if(all(edge)){demandPage(m,home+step);}
}
/** The sun's pages at the point: its footprint's level, or the first coarser one whose window
 *  holds its home page (\`sunShadowFactor\`, the same \`sunReadAt\`). */
fn demandSun(index:u32,P:vec3f,N:vec3f,footprint:f32){
 let axis=shadows.records[index].frame[2].xyz;let info=shadows.records[index].info;
 let finest=i32(info.y);let last=finest+i32(info.x);
 let offset=shadowNormalTexels(clamp(dot(N,-axis),1e-3,1.0));
 for(var level=shadowSunReadLevel(footprint,finest);level<last;level++){
  let at=sunReadAt(index,P,N,offset,level);
  if(shadowPageEntry(at.map,at.home)<0){continue;}
  demandPages(at.map,at.t,at.home);
  return;
 }
}
/** The lamp's pages at the point: its footprint's mip, on the face its offset point lies in
 *  (\`lampShadowFactor\`, the same \`lampReadAt\`); none past the face's depth or outside a
 *  spot's cone. */
fn demandLamp(index:u32,light:DirectLight,P:vec3f,N:vec3f,L:vec3f,footprint:f32){
 let texel0=shadowLampFinestTexel(shadows.records[index].info.y,length(light.positionRange.xyz-P));
 let mip=u32(shadowLampReadMip(footprint,texel0));
 let r=lampReadAt(index,light.positionRange.xyz,P,N,shadowNormalTexels(clamp(dot(N,L),1e-3,1.0)),texel0,mip);
 if(r.inside){demandPages(r.at.map,r.at.t,r.at.home);}
}
/** A light's pages at the point, behind the resolve's gate (\`declaredLight\`, \`shadowFactor\`):
 *  a shadowed punctual light that reaches it. */
fn demandLight(light:DirectLight,P:vec3f,N:vec3f,footprint:f32){
 let slice=i32(light.params.y);
 if(isRect(light)||slice<0){return;}
 let incidence=directIncidence(light,P);
 if(incidence.w<=0.0){return;}
 let index=u32(slice);
 if(shadows.records[index].info.x<0.5){return;}
 if(isSun(light)){demandSun(index,P,N,footprint);}else{demandLamp(index,light,P,N,incidence.xyz,footprint);}
}
@compute @workgroup_size(${SHADOW_DEMAND_GROUP},${SHADOW_DEMAND_GROUP}) fn markShadowDemand(@builtin(global_invocation_id) id:vec3u){
 if(any(vec2f(id.xy)>=view.viewport.xy)||u32(view.lightParams.x)==0u){return;}
 let coord=vec2i(id.xy);
 let flag=textureLoad(flags,coord,0).r&${FOG_FREE_SURFACE_FLAG - 1}u;
 if(flag<=1u||flag==${AS_IS_FLAG}u){return;}
 let tile=id.xy/TILE_SIZE;let tilesX=u32(view.lightParams.y);
 if(tile.x>=tilesX||tile.y>=u32(view.lightParams.z)){return;}
 // The resolve's point and footprint, at the pixel's centre.
 let z=textureLoad(depth,coord,0);let pixel=vec2f(id.xy)+0.5;
 let P=worldAt(pixel,z);
 let footprint=length(worldAt(pixel+vec2f(1.0,0.0),z)-P);
 let N=normalize(textureLoad(normalRough,coord,0).xyz);
 let slice=tileSlice((tile.y*tilesX+tile.x)*TILE_STRIDE,0u,TILE_OPAQUE_BASE);
 for(var index=0u;index<slice.y;index++){
  var light=index;
  if(slice.x!=TILE_NO_SLICE){light=tileLights[slice.x+index];}
  demandLight(directLights.items[light],P,N,footprint);
 }
}`;
