import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { FLOAT32_MAX } from '../../../math/src/wgsl/constants.ts'
import { edgeFunction } from '../../../math/src/wgsl/barycentric.ts'
import { faceNormal } from '../../../math/src/wgsl/geometry.ts'
import { bitIsSet } from '../../../math/src/wgsl/integer.ts'
import { PAGE_GEOMETRY_WGSL } from '../visibility/shader/pageGeometryWgsl.ts'
import { PAGE_INFO_WGSL, maskKeepWgsl } from '../visibility/shader/pageWgsl.ts'
import { FLAG_HAS_MAP, FLAG_HAS_UV, FLAG_MASK } from '../visibility/types.ts'
import { colorSampleWgsl, maskAlphaWgsl, SHADOW_TILE_POOL_WGSL } from '../webgpu/tile/wgsl.ts'
import { blendTransmittanceWgsl } from '../gpu/shadow/transmittanceWgsl.ts'
import { VSM_CONSTANTS_WGSL, VSM_PAGE_TEXELS } from './constants.ts'
import { VSM_CASTER_PROJECTION_WGSL } from './renderRasterWgsl.ts'
import { VSM_PROJECTION_DATA_WGSL } from './projectionDataWgsl.ts'
import type { VsmLayout } from './layout.ts'
import { VSM_TRANSMISSION_COVER_WGSL } from './transmissionGeometryWgsl.ts'
import { CLOCKWISE_BIT, TEXTURED_BIT, frameWgsl } from './transmissionShared.ts'

/**
 * What the bin (`transmissionBinWgsl.ts`) does with one triangle of a command's row: projected on
 * the command's level (\`vsmTProject\`), then each of its (page, triangle) recorded into its slice
 * with its patch and its cells (\`vsmTRecord\`). Reads its host's \`frame\` uniform and \`build\`
 * buffer, and the shadow pool's material reads (\`maskAlpha\`, \`colorSample\`).
 */
export const vsmTransmissionRecordWgsl = (layout: VsmLayout) => {
  const maskAlpha = maskAlphaWgsl(true, SHADOW_TILE_POOL_WGSL)
  return wgslBlock(
    `vsmTransmissionRecord(${layout.poolPages})`,
    [
      PAGE_INFO_WGSL,
      maskKeepWgsl(maskAlpha),
      VSM_CONSTANTS_WGSL,
      VSM_PROJECTION_DATA_WGSL,
      VSM_CASTER_PROJECTION_WGSL,
      frameWgsl(layout),
      VSM_TRANSMISSION_COVER_WGSL,
      PAGE_GEOMETRY_WGSL,
      blendTransmittanceWgsl(maskAlpha, colorSampleWgsl(SHADOW_TILE_POOL_WGSL)),
      FLOAT32_MAX,
      edgeFunction,
      faceNormal,
      bitIsSet,
    ],
    /* wgsl */ `
/** Whether the row's transmittance varies over a triangle: a map or a mask read at its uv. */
fn vsmTVaries(page:PageInfo)->bool{
 return (page.flags&${FLAG_HAS_UV}u)!=0u&&(page.flags&${FLAG_HAS_MAP | FLAG_MASK}u)!=0u;
}
/** The quantised transmittance the old texel store held: 1 − through, 8 bits a channel, 0 for a
 *  point the mask cuts or one that lets all through. */
fn vsmTQuantised(page:PageInfo,uv:vec2f,gx:vec2f,gy:vec2f,ray:vec3f)->u32{
 if(!maskKeep(page,uv,1.0,gx,gy)){return 0u;}
 let through=clamp(blendTransmittance(page,uv,gx,gy,ray).rgb,vec3f(0.0),vec3f(1.0));
 if(all(through>=vec3f(1.0))){return 0u;}
 return pack4x8unorm(vec4f(1.0-through,0.0));
}
/** A projected corner: its homogeneous map position and its uv. */
struct VsmTCorner{h:vec4f,uv:vec2f,}
/** The corner where segment (inside, outside) meets the near plane w − z = 0, from the inside
 *  corner: a segment two triangles share is cut to the same bits by both. */
fn vsmTCut(i:VsmTCorner,o:VsmTCorner)->VsmTCorner{
 let di=i.h.w-i.h.z;let t=di/(di-(o.h.w-o.h.z));
 return VsmTCorner(i.h+(o.h-i.h)*t,i.uv+(o.uv-i.uv)*t);
}
/** Texels of the page of a homogeneous map position: the raster's mapping. */
fn vsmTTexel(h:vec4f,scale:f32,corner:vec2f)->vec2f{return vec2f(h.x/h.w*scale,h.y/h.w*scale)-corner;}
/** The uv at texel point \`p\` of the projected triangle, perspective-correct. */
fn vsmTUvAt(x:array<vec2f,3>,c:array<VsmTCorner,3>,p:vec2f)->vec2f{
 let b=vec3f(edgeFunction(x[1],x[2],p),edgeFunction(x[2],x[0],p),edgeFunction(x[0],x[1],p))/vec3f(c[0].h.w,c[1].h.w,c[2].h.w);
 return (b.x*c[0].uv+b.y*c[1].uv+b.z*c[2].uv)/(b.x+b.y+b.z);
}
/** A record's cells, for the resolve: the cell range a box [lo, hi] grown by 2⁻¹⁰ texel meets
 *  (\`vsmTCellRange\`), four bits a corner, and bit 16 when the triangle turns clockwise. */
fn vsmTCellsWord(lo:vec2f,hi:vec2f,area:f32)->u32{
 let r=vec4u(vsmTCellRange(lo,hi));
 return r.x|(r.y<<4u)|(r.z<<8u)|(r.w<<12u)|select(0u,${CLOCKWISE_BIT}u,area<0.0);
}
/**
 * One projected triangle into slice \`key\`: \`x\` its corners in page texels, \`c\` their map
 * positions and uv, \`shape\` record words 6 to 9 after the corners' (directional d0 d1 d2 0, local
 * n w), \`q\` its quantised transmittance (textured: from its patch).
 */
fn vsmTRecord(page:PageInfo,row:u32,key:u32,x:array<vec2f,3>,c:array<VsmTCorner,3>,shape:vec4f,q:u32,ray:vec3f){
 let area=edgeFunction(x[0],x[1],x[2]);
 if(area==0.0){return;}
 let lo=min(min(x[0],x[1]),x[2]);let hi=max(max(x[0],x[1]),x[2]);
 if(hi.x<0.0||hi.y<0.0||lo.x>=${VSM_PAGE_TEXELS}.0||lo.y>=${VSM_PAGE_TEXELS}.0){return;}
 let textured=vsmTVaries(page);
 // The patch first: the box on the page, a texel wider each side, every centre a bilinear read
 // takes. A record slot is taken only once its patch holds, so every slot the resolve reads is
 // written this frame.
 var patchAt=0u;var patchLocal=0u;var origin=vec2i(0);var size=vec2u(0u);
 if(textured){
  origin=max(vec2i(floor(lo))-vec2i(1),vec2i(-1));
  let end=min(vec2i(ceil(hi))+vec2i(1),vec2i(${VSM_PAGE_TEXELS + 1}));
  size=vec2u(end-origin);
  let words=size.x*size.y;
  patchAt=atomicAdd(&build[VSM_TC_PATCHWORDS],words);
  if(patchAt+words>frame.patchWords){return;}
 }
 let g=atomicAdd(&build[VSM_TC_RECORDS],1u);
 if(g>=frame.records){return;}
 let local=atomicAdd(&build[VSM_T_COUNTS+key],1u);
 if(textured){
  let words=size.x*size.y;
  patchLocal=atomicAdd(&build[VSM_T_PATCH+key],(words+3u)&~3u);
  let base=frame.regionPatches+patchAt;
  for(var j=0u;j<size.y;j++){
   for(var i=0u;i<size.x;i++){
    let p=vec2f(origin+vec2i(vec2u(i,j)))+0.5;
    let uv=vsmTUvAt(x,c,p);
    let gx=vsmTUvAt(x,c,p+vec2f(1.0,0.0))-uv;let gy=vsmTUvAt(x,c,p+vec2f(0.0,1.0))-uv;
    atomicStore(&build[base+j*size.x+i],vsmTQuantised(page,uv,gx,gy,ray));
   }
  }
 }
 let r=frame.regionRecords+g*VSM_T_RECORD_WORDS;
 atomicStore(&build[r],bitcast<u32>(x[0].x));atomicStore(&build[r+1u],bitcast<u32>(x[0].y));
 atomicStore(&build[r+2u],bitcast<u32>(x[1].x));atomicStore(&build[r+3u],bitcast<u32>(x[1].y));
 atomicStore(&build[r+4u],bitcast<u32>(x[2].x));atomicStore(&build[r+5u],bitcast<u32>(x[2].y));
 atomicStore(&build[r+6u],bitcast<u32>(shape.x));atomicStore(&build[r+7u],bitcast<u32>(shape.y));
 atomicStore(&build[r+8u],bitcast<u32>(shape.z));atomicStore(&build[r+9u],bitcast<u32>(shape.w));
 atomicStore(&build[r+10u],select(q,${TEXTURED_BIT}u,textured));
 atomicStore(&build[r+11u],row);
 atomicStore(&build[r+12u],patchLocal);
 atomicStore(&build[r+13u],u32(origin.x+1)|(u32(origin.y+1)<<16u));
 atomicStore(&build[r+14u],size.x|(size.y<<16u));
 atomicStore(&build[r+15u],0u);
 atomicStore(&build[r+16u],key);
 atomicStore(&build[r+17u],local);
 atomicStore(&build[r+18u],patchAt);
 atomicStore(&build[r+19u],vsmTCellsWord(lo,hi,area));
}
/** A triangle of the row projected on the command's level: its 0, 3 or 4 corners (a local
 *  light's near plane fans 4 into two), their box in the level's texels, its record shape, its
 *  quantised transmittance and its ray. */
struct VsmTTri{h:array<vec4f,4>,uv:array<vec2f,4>,shape:vec4f,box:vec4f,ray:vec3f,count:u32,q:u32,}
fn vsmTProject(page:PageInfo,h:ClusterHeader,t:u32,view:u32,raw:VsmProjectionRecord)->VsmTTri{
 var out:VsmTTri;
 let tri=pageTriangle(page,h,t);
 let M=raw.shiftedToMapUv;
 let isOrtho=raw.lightViewToClip[3][3]>=1.0;
 let flatten=bitIsSet(view,20u);
 let mapped=(page.flags&${FLAG_HAS_UV}u)!=0u;
 var world:array<vec3f,3>;var shifted:array<vec3f,3>;var corners:array<VsmTCorner,3>;
 for(var i=0u;i<3u;i++){
  world[i]=vsmRenderWorld(page,h,tri[i]);
  shifted[i]=vsmRenderShifted(raw,world[i]);
  // A sun level's corner in front of its near plane is flattened onto it, as the opaque raster
  // flattens it; an orthographic corner's depth is read no further.
  corners[i]=VsmTCorner(vsmRenderClip(raw,shifted[i],flatten),select(vec2f(0.0),pageUv(page,h,tri[i]),mapped));
 }
 // Both faces; the volume rule needs the side facing the light.
 let axis=vec3f(M[0].z,M[1].z,M[2].z);
 let front=vsmRenderFacesLight(page,raw,world[0],world[1],world[2],shifted[0]);
 if(!volumeBoundary(page,front)){return out;}
 out.ray=select(shifted[0],axis,isOrtho);
 if(!vsmTVaries(page)){
  out.q=vsmTQuantised(page,vec2f(0.0),vec2f(0.0),vec2f(0.0),out.ray);
  if(out.q==0u){return out;}
 }
 // The record's shape: each corner along the unit axis toward the light, or the plane in
 // light-relative space (the light at the shifted origin).
 if(isOrtho){
  let a=normalize(axis);
  out.shape=vec4f(dot(world[0],a),dot(world[1],a),dot(world[2],a),0.0);
 }else{
  let nl=normalize(faceNormal(shifted[0],shifted[1],shifted[2]));
  out.shape=vec4f(nl,dot(nl,shifted[0]));
 }
 // A local light's near plane: the polygon kept on w − z ≥ 0, 0 to 4 corners, fanned.
 if(isOrtho){
  for(var i=0u;i<3u;i++){out.h[i]=corners[i].h;out.uv[i]=corners[i].uv;}
  out.count=3u;
 }else{
  for(var i=0u;i<3u;i++){
   let a=corners[i];let b=corners[(i+1u)%3u];
   let ina=a.h.w-a.h.z>=0.0;let inb=b.h.w-b.h.z>=0.0;
   if(ina){out.h[out.count]=a.h;out.uv[out.count]=a.uv;out.count++;}
   if(ina!=inb){
    var cut:VsmTCorner;
    if(ina){cut=vsmTCut(a,b);}else{cut=vsmTCut(b,a);}
    out.h[out.count]=cut.h;out.uv[out.count]=cut.uv;out.count++;
   }
  }
 }
 let scale=f32(VSM_LEVEL0_TEXELS>>((view>>16u)&7u));
 var lo=vec2f(FLOAT32_MAX);var hi=vec2f(-FLOAT32_MAX);
 for(var i=0u;i<out.count;i++){let v=vsmTTexel(out.h[i],scale,vec2f(0.0));lo=min(lo,v);hi=max(hi,v);}
 out.box=vec4f(lo,hi);
 return out;
}`,
  )
}
