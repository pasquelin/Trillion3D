import { POINT_FACES } from '../../../../sdk-core/src/index.ts';
import { VIEW_WGSL, WORLD_AT_WGSL } from '../../lighting/deferred/shaders.ts';
import { PIXEL_FOOTPRINT_WGSL } from '../../lighting/deferred/footprintWgsl.ts';
import { LAMP_SOFT_DISK_WGSL } from '../../lighting/direct/lampSoftWgsl.ts';
import { DIRECT_LIGHT_WGSL } from '../../lighting/direct/lightWgsl.ts';
import { TILE_SLICE_WGSL } from '../../lighting/direct/lightingWgsl.ts';
import { SHADOW_READ_AT_WGSL } from '../../lighting/direct/shadowFactorWgsl.ts';
import { shadowRequestWgsl } from '../../lighting/direct/shadowRequestWgsl.ts';
import {
  PCF_TAPS_WGSL,
  SHADOW_DATA_WGSL,
  shadowPageReadWgsl,
} from '../../lighting/direct/shadowWgsl.ts';
import { SUN_WINDOW } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { SUBSURFACE_FLAG } from '../../scene/subsurface.ts';
import { AS_IS_FLAG, FOG_FREE_SURFACE_FLAG } from '../../scene/surfaceModel.ts';
import { receiverOffsetWgsl } from '../../visibility/shader/receiverOffsetWgsl.ts';

/** Pixels a side of a workgroup of the demand pass. */
export const SHADOW_DEMAND_GROUP = 8;
/** First binding of what the demand's receiver offset reads (`RECEIVER_BINDINGS`). */
const DEMAND_RECEIVER_BINDING = 8;

/**
 * THE PER-PIXEL DEMAND OF SHADOW PAGES (#1275): one invocation per pixel of the visibility buffer,
 * after depth and before any shadow page is drawn or read. A pixel the resolve lights marks, for
 * every shadowed light of its tile's opaque list, the pages that light's read wants at it — the
 * sun level or the lamp mip of its footprint, its home page and the neighbours the PCF reaches
 * across a page edge, and, for a point lamp with a radius, every page its soft shadow's taps
 * read (`demandSoftLamp`) — in the request buffer the resolve records into (`requestShadowPage`).
 *
 * Every step is the shading's own: the view and the world point its resolve reconstructs
 * (`WORLD_AT_WGSL`, the deferred pass's view uniform), moved by the pixel's shading-point offset
 * (`receiverOffset`, the lighting's, recomputed from the visibility buffer), its normal turned
 * from a light behind a thin subsurface surface (`declaredLight`), its tile slice, its light gate,
 * its footprint and point unjittered (`pixelLevel`), the turn of its taps (`shadowRotated`), and
 * the page model (`pageModel.ts`) its read takes the level, the map texel, the entry and the PCF's
 * pages from. Unlike the read, the demand never falls back: a page not drawn yet is the one it
 * wants. The layout it marks is the session's window (`referenceMode.ts`), the ordinary constant
 * by default.
 */
export const shadowDemandWgsl = (pages = SUN_WINDOW) => `
${VIEW_WGSL}
@group(0) @binding(0) var depth:texture_depth_2d;
@group(0) @binding(1) var normalRough:texture_2d<f32>;
@group(0) @binding(2) var flags:texture_2d<u32>;
@group(0) @binding(3) var<uniform> view:View;
@group(0) @binding(4) var<storage,read> directLights:DirectLights;
@group(0) @binding(5) var<storage,read> tileLights:array<u32>;
${SHADOW_DATA_WGSL}
@group(0) @binding(6) var<storage,read> shadows:ShadowData;
${shadowRequestWgsl(7, pages)}
${receiverOffsetWgsl(DEMAND_RECEIVER_BINDING)}
${DIRECT_LIGHT_WGSL}
${TILE_SLICE_WGSL}
${shadowPageReadWgsl(pages)}
${SHADOW_READ_AT_WGSL}
${PCF_TAPS_WGSL}
${LAMP_SOFT_DISK_WGSL}
${WORLD_AT_WGSL}
${PIXEL_FOOTPRINT_WGSL}
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
/** Where the segment \`P + v·s\` leaves, past \`s\`, the page \`r\` it reads there, seen from the lamp:
 *  the least crossing of that page's four edges on its face — the clip position is affine in \`s\`,
 *  so each is exact —, a face's border being its last page's; 2 when none comes. */
fn softPageExit(index:u32,P:vec3f,v:vec3f,r:LampAt,s:f32)->f32{
 let m=shadows.records[index].faces[r.face];
 let a=m*vec4f(P,1.0);let b=m*vec4f(v,0.0);
 let pages=r.side/SHADOW_PAGE;
 var exit=2.0;
 for(var axis=0u;axis<2u;axis++){
  // A map texel's row runs down the face: \`-ndc.y\` (\`lampReadAt\`).
  let flip=select(-1.0,1.0,axis==0u);let page=f32(r.at.home[axis]);
  for(var high=0u;high<2u;high++){
   let edge=select(shadowRegionLow(pages,page),shadowRegionHigh(pages,page),high==1u);
   let across=flip*b[axis]-edge*b.w;
   if(abs(across)<1e-20){continue;}
   let u=(edge*a.w-flip*a[axis])/across;
   if(u>s){exit=min(exit,u);}
  }
 }
 return exit;
}
/** The pages a soft shadow's filter tap at \`Q\` reads, its bilinear footprint split along the seams
 *  it comes near (\`lampSoftCompare\`): its lookup's home page and the neighbours \`demandPages\` marks. */
fn demandSoftAt(index:u32,lamp:vec3f,Q:vec3f,N:vec3f,mip:u32){
 let r=lampReadAt(index,lamp,Q,N,0.0,1.0,mip);demandPages(r.at.map,r.at.t,r.at.home);
}
/** Every page of \`mip\` a point lamp's soft shadow reads (\`pointSoftShadow\`) at \`P\`, the
 *  offset point of \`centre\`: a tap of its blocker search lies at \`P + v\`, one of its filter at
 *  \`P + v·s\`, \`s\` the penumbra over the search, at most 1 — each tap on the segment from \`P\`
 *  to its search tap, its disk turned this jitter phase (\`shadowRotated\`). Each segment is walked
 *  page by page through the tap's own lookup (\`lampReadAt\`, as \`lampDiskSample\`), across the
 *  cube's faces: every page its taps can read is marked, whatever the blockers found. A segment's
 *  image in a face is straight, so its distance to a page's edge is least at an end of its part in
 *  that page: the neighbours a filter tap's footprint reaches are those of the ends' reads. */
fn demandSoftLamp(index:u32,light:DirectLight,centre:LampAt,N:vec3f,mip:u32){
 let P=centre.at.Q;
 let d=lampSoftDisk(index,light,P);
 let lamp=light.positionRange.xyz;
 for(var tap=0u;tap<PCF_TAPS;tap++){
  let disk=shadowRotated(POISSON[tap]);let v=(d.T*disk.x+d.B*disk.y)*d.search;
  // \`P\` reads \`centre\`, the lookup whose pages \`demandLamp\` marked: the walk starts at its exit —
  // at once when \`P\` lies on the edge the segment leaves by, a crossing at \`s = 0\` (#1363).
  var r=centre;var s=-1e-5;
  // A segment spans under 60° (\`search\` < \`distance\`, a tap within 1.3 of the disk's centre):
  // at most three faces, and two pages a row of each crossed.
  for(var k=0u;k<=6u*LAMP_PAGE_COUNT;k++){
   let exit=softPageExit(index,P,v,r,s);
   demandSoftAt(index,lamp,P+v*(min(exit,1.0)-1e-5),N,mip);
   s=exit+1e-5;
   if(s>1.0||k==6u*LAMP_PAGE_COUNT){break;}
   r=lampReadAt(index,lamp,P+v*s,N,0.0,1.0,mip);
   demandPages(r.at.map,r.at.t,r.at.home);
  }
 }
}
/** The lamp's pages at the point: its footprint's mip, on the face its offset point lies in
 *  (\`lampShadowFactor\`, the same \`lampReadAt\`), and its soft shadow's; none past the face's
 *  depth or outside a spot's cone. */
fn demandLamp(index:u32,light:DirectLight,P:vec3f,N:vec3f,L:vec3f,footprint:f32){
 let texel0=shadowLampFinestTexel(shadows.records[index].info.y,length(light.positionRange.xyz-(P+shadowUnjitter)));
 let mip=u32(shadowLampReadMip(footprint,texel0));
 let r=lampReadAt(index,light.positionRange.xyz,P,N,shadowNormalTexels(clamp(dot(N,L),1e-3,1.0)),texel0,mip);
 if(!r.inside){return;}
 demandPages(r.at.map,r.at.t,r.at.home);
 if(u32(shadows.records[index].info.x)==${POINT_FACES}u&&light.shape.x>0.0){demandSoftLamp(index,light,r,N,mip);}
}
/** A light's pages at the point, behind the resolve's gate (\`declaredLight\`, \`shadowFactor\`):
 *  a shadowed punctual light that reaches point \`at\`, read at \`receiver\` — \`at\` moved by its
 *  shading-point offset —, the normal turned when the light is behind a \`thin\` surface. */
fn demandLight(light:DirectLight,at:vec3f,receiver:vec3f,N:vec3f,thin:bool,footprint:f32){
 let slice=i32(light.params.y);
 if(isRect(light)||slice<0){return;}
 let incidence=directIncidence(light,at);
 if(incidence.w<=0.0){return;}
 let index=u32(slice);
 if(shadows.records[index].info.x<0.5){return;}
 let n=select(N,-N,thin&&dot(N,incidence.xyz)<0.0);
 if(isSun(light)){demandSun(index,receiver,n,footprint);}else{demandLamp(index,light,receiver,n,incidence.xyz,footprint);}
}
@compute @workgroup_size(${SHADOW_DEMAND_GROUP},${SHADOW_DEMAND_GROUP}) fn markShadowDemand(@builtin(global_invocation_id) id:vec3u){
 if(any(vec2f(id.xy)>=view.viewport.xy)||u32(view.lightParams.x)==0u){return;}
 let coord=vec2i(id.xy);
 let flag=textureLoad(flags,coord,0).r&${FOG_FREE_SURFACE_FLAG - 1}u;
 if(flag<=1u||flag==${AS_IS_FLAG}u){return;}
 let tile=id.xy/TILE_SIZE;let tilesX=u32(view.lightParams.y);
 if(tile.x>=tilesX||tile.y>=u32(view.lightParams.z)){return;}
 // A tile without a light asks nothing: its pixels load no depth.
 let slice=tileSlice((tile.y*tilesX+tile.x)*TILE_STRIDE,0u,TILE_OPAQUE_BASE);
 if(slice.y==0u){return;}
 // The resolve's point, footprint and taps' turn, at the pixel's centre (\`surfaceWgsl.ts\`).
 let z=textureLoad(depth,coord,0);let pixel=vec2f(id.xy)+0.5;
 let at=worldAt(pixel,z);
 let level=pixelLevel(coord,pixel,z,at);shadowUnjitter=level.unjitter;shadowRotation=view.jitter.zw;
 // The point the shading reads the maps at (\`shadowReceiverOffset\`, \`surfaceWgsl.ts\`).
 let P=at+receiverOffset(pixel);
 let N=normalize(textureLoad(normalRough,coord,0).xyz);
 let thin=(textureLoad(flags,coord,0).r&${SUBSURFACE_FLAG}u)!=0u;
 for(var index=0u;index<slice.y;index++){
  var light=index;
  if(slice.x!=TILE_NO_SLICE){light=tileLights[slice.x+index];}
  demandLight(directLights.items[light],at,P,N,thin,level.footprint);
 }
}`;
