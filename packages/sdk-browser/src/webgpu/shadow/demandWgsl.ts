import { POINT_FACES } from '../../../../sdk-core/src/index.ts';
import { VIEW_WGSL, WORLD_AT_WGSL } from '../../lighting/deferred/shaders.ts';
import { PIXEL_FOOTPRINT_WGSL } from '../../lighting/deferred/footprintWgsl.ts';
import { LAMP_SOFT_DISK_WGSL } from '../../lighting/direct/lampSoftWgsl.ts';
import { DIRECT_LIGHT_WGSL } from '../../lighting/direct/lightWgsl.ts';
import { TILE_SLICE_WGSL, pixelCellWgsl } from '../../lighting/direct/lightingWgsl.ts';
import { SHADOW_READ_AT_WGSL } from '../../lighting/direct/shadowFactorWgsl.ts';
import { shadowRequestWgsl } from '../../lighting/direct/shadowRequestWgsl.ts';
import {
  PCF_TAPS_WGSL,
  SHADOW_DATA_WGSL,
  shadowPageReadWgsl,
} from '../../lighting/direct/shadowWgsl.ts';
import { SUN_WINDOW } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { SUBSURFACE_FLAG } from '../../scene/subsurface.ts';
import { AS_IS_FLAG, SURFACE_MODEL_MASK } from '../../scene/surfaceModel.ts';
import { receiverOffsetWgsl } from '../../visibility/shader/receiverOffsetWgsl.ts';

/** Pixels a side of a workgroup of the demand pass. */
export const SHADOW_DEMAND_GROUP = 8;
/** First binding of what the demand's receiver offset reads (`RECEIVER_BINDINGS`). */
const DEMAND_RECEIVER_BINDING = 8;

/**
 * What a reader of shadow pages marks of them, light by light (`demandLight`) over its cell's
 * list (`demandSlice`): the per-pixel demand below, and the transparent surfaces' marks
 * (`../blend/marksWgsl.ts`, #1411) — one demand path for every receiver, as the reference engine's virtual
 * shadow maps mark the pages every receiver samples. The host text declares the shadow records,
 * the page model, the reads (`sunReadAt`, `lampReadAt`, `lampSoftDisk`), the light lists and
 * `requestShadowPage` before it.
 */
export const SHADOW_DEMAND_LIGHT_WGSL = `/** Marks page \`p\` of the map: nothing outside a ring's window. */
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
/** The pages of \`mip\` a PCSS disk of half-side \`reach\` metres around \`C\`'s point reads, in the
 *  plane of \`T\` and \`B\` across the lamp's ray: in each face, the pages under the box its square's
 *  corners project to, a texel of bilinear footprint beyond — a central projection keeps the
 *  square's image convex, so every tap lies in that box. Under \`LAMP_SOFT_TEXELS\` texels of the
 *  mip a side, a box spans two pages at most; a face is one page at the last mip. A square within
 *  its centre's face marks that face alone; else each face is tried, one with a corner behind its
 *  eye — at the last mip only, where the square may be wide — asked whole. */
fn demandSoftDisk(index:u32,C:LampAt,T:vec3f,B:vec3f,reach:f32,mip:u32){
 let info=shadows.records[index].info;
 let pages=LAMP_PAGE_COUNT>>mip;
 for(var k=0u;k<=${POINT_FACES}u;k++){
  // First the centre's face; the six faces after, unless the square lay within it.
  let face=select(k-1u,C.face,k==0u);
  if(k>0u&&face==C.face){continue;}
  var low=vec2f(3.0e38);var high=vec2f(-3.0e38);var behind=false;
  for(var c=0u;c<4u;c++){
   let corner=C.at.Q+(T*select(-1.0,1.0,c<2u)+B*select(-1.0,1.0,(c&1u)==0u))*reach;
   let f=lampFacePoint(index,face,corner,C.side);
   behind=behind||f.clip.w<=0.0;
   low=min(low,f.t);high=max(high,f.t);
  }
  let map=ShadowMap(u32(info.w)+u32(shadowLampMapEntry(i32(face),i32(mip))),0u,i32(pages),0,0);
  if(behind){if(mip+1u==LAMP_MIP_COUNT){demandPage(map,vec2i(0));}continue;}
  if(any(high<vec2f(-1.0))||any(low>vec2f(C.side+1.0))){continue;}
  let first=clamp(vec2i(shadowPageOfTexel(low.x-1.0),shadowPageOfTexel(low.y-1.0)),vec2i(0),vec2i(i32(pages)-1));
  let last=min(clamp(vec2i(shadowPageOfTexel(high.x+1.0),shadowPageOfTexel(high.y+1.0)),vec2i(0),vec2i(i32(pages)-1)),first+vec2i(1));
  for(var y=first.y;y<=last.y;y++){for(var x=first.x;x<=last.x;x++){demandPage(map,vec2i(x,y));}}
  if(k==0u&&all(low>=vec2f(0.0))&&all(high<=vec2f(C.side))){return;}
 }
}
/** Every page a point lamp's soft shadow reads (\`pointSoftShadow\`) at \`P\`, its taps' disks at
 *  their mips (\`lampSoftMip\`): from the pixel's \`mip\` to the search's, each mip the widest disk
 *  it serves — a penumbra up to \`LAMP_SOFT_TEXELS\` of its texels, the lamp's whole disk at the
 *  search's. At most a few pages a mip and a mip chain's length: bounded, whatever the lamp's
 *  radius or the pages its disk crosses, and the same every image. */
fn demandSoftLamp(index:u32,light:DirectLight,P:vec3f,N:vec3f,offset:f32,texel0:f32,mip:u32){
 let lamp=light.positionRange.xyz;
 let d=lampSoftDisk(index,light,lampSoftCentre(P,N,offset,texel0,mip));
 let search=lampSoftMip(d.search,texel0,mip);
 for(var m=mip;m<=search;m++){
  let scale=select(min(d.search,LAMP_SOFT_TEXELS*texel0*exp2(f32(m))),d.search,m==search);
  demandSoftDisk(index,lampReadAt(index,lamp,P,N,offset,texel0,m),d.T,d.B,scale*POISSON_RADIUS,m);
 }
}
/** The lamp's pages at the point: its footprint's mip, on the face its offset point lies in
 *  (\`lampShadowFactor\`, the same \`lampReadAt\`), and its soft shadow's; none past the face's
 *  depth or outside a spot's cone. */
fn demandLamp(index:u32,light:DirectLight,P:vec3f,N:vec3f,L:vec3f,footprint:f32){
 let texel0=shadowLampFinestTexel(shadows.records[index].info.y,length(light.positionRange.xyz-(P+shadowUnjitter)));
 let mip=u32(shadowLampReadMip(footprint,texel0));
 let offset=shadowNormalTexels(clamp(dot(N,L),1e-3,1.0));
 let r=lampReadAt(index,light.positionRange.xyz,P,N,offset,texel0,mip);
 if(!r.inside){return;}
 demandPages(r.at.map,r.at.t,r.at.home);
 if(u32(shadows.records[index].info.x)==${POINT_FACES}u&&light.shape.x>0.0){demandSoftLamp(index,light,P,N,offset,texel0,mip);}
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
/** Marks the pages of every light of \`slice\` (\`cellSlice\`), or of every declared light past the
 *  grid (\`TILE_NO_SLICE\`), at the point, normal and footprint the receiver's read takes. */
fn demandSlice(slice:vec2u,at:vec3f,receiver:vec3f,N:vec3f,thin:bool,footprint:f32){
 for(var index=0u;index<slice.y;index++){
  var light=index;
  if(slice.x!=TILE_NO_SLICE){light=tileLights[slice.x+index];}
  demandLight(directLights.items[light],at,receiver,N,thin,footprint);
 }
}`;

/**
 * THE PER-PIXEL DEMAND OF SHADOW PAGES (#1275): one invocation per pixel of the visibility buffer,
 * after depth and before any shadow page is drawn or read. A pixel the resolve lights marks, for
 * every shadowed light of its tile's opaque list, the pages that light's read wants at it — the
 * sun level or the lamp mip of its footprint, its home page and the neighbours the PCF reaches
 * across a page edge, and, for a point lamp with a radius, the few pages around its soft shadow's
 * disks at their mips (`demandSoftLamp`), a bounded count per pixel — in the request buffer the resolve records into (`requestShadowPage`).
 *
 * Every step is the shading's own: the view and the world point its resolve reconstructs
 * (`WORLD_AT_WGSL`, the deferred pass's view uniform), moved by the pixel's shading-point offset
 * (`receiverOffset`, the lighting's, recomputed from the visibility buffer), its normal turned
 * from a light behind a thin subsurface surface (`declaredLight`), its tile slice, its light gate,
 * its footprint and point unjittered (`pixelLevel`), and the page model (`pageModel.ts`) its read
 * takes the level, the map texel, the entry and the PCF's pages from. Unlike the read, the demand
 * never falls back: a page not drawn yet is the one it wants. The layout it marks is the session's
 * window (`referenceMode.ts`), the ordinary constant by default.
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
${pixelCellWgsl()}
${shadowPageReadWgsl(pages)}
${SHADOW_READ_AT_WGSL}
${PCF_TAPS_WGSL}
${LAMP_SOFT_DISK_WGSL}
${WORLD_AT_WGSL}
${PIXEL_FOOTPRINT_WGSL}
${SHADOW_DEMAND_LIGHT_WGSL}
@compute @workgroup_size(${SHADOW_DEMAND_GROUP},${SHADOW_DEMAND_GROUP}) fn markShadowDemand(@builtin(global_invocation_id) id:vec3u){
 if(any(vec2f(id.xy)>=view.viewport.xy)||u32(view.lightParams.x)==0u){return;}
 let coord=vec2i(id.xy);
 let flag=textureLoad(flags,coord,0).r&${SURFACE_MODEL_MASK}u;
 if(flag<=1u||flag==${AS_IS_FLAG}u){return;}
 // The resolve's cell (\`pixelCell\`, \`surfaceWgsl.ts\`): a cell that lists no light with a shadow
 // slot asks nothing, as the resolve sets up no shadow read there (\`cellShadowed\`).
 let z=textureLoad(depth,coord,0);let pixel=vec2f(id.xy)+0.5;
 let cell=pixelCell(pixel,z);
 if(!cellShadowed(cell)){return;}
 let slice=cellSlice(cell);
 // The resolve's point and footprint, at the pixel's centre (\`surfaceWgsl.ts\`).
 let at=worldAt(pixel,z);
 let level=pixelLevel(coord,pixel,z,at);shadowUnjitter=level.unjitter;
 // The point the shading reads the maps at (\`shadowReceiverOffset\`, \`surfaceWgsl.ts\`).
 let P=at+receiverOffset(pixel);
 let N=normalize(textureLoad(normalRough,coord,0).xyz);
 let thin=(textureLoad(flags,coord,0).r&${SUBSURFACE_FLAG}u)!=0u;
 demandSlice(slice,at,P,N,thin,level.footprint);
}`;
