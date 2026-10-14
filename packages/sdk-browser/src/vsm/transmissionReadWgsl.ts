import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { NO_INDEX } from '../../../math/src/constants.ts'
import { floorLog2 } from '../../../math/src/scalar/integers.ts'
import { highHalf, lowHalf } from '../../../math/src/wgsl/integer.ts'
import { bilinear3 } from '../../../math/src/wgsl/sampling.ts'
import { VSM_PAGE_TEXELS } from './constants.ts'
import { VSM_PROJECTION_DATA_READ_WGSL } from './projectionDataWgsl.ts'
import { VSM_TRANSMISSION_BLOCK_TEXELS, VSM_TRANSMISSION_WIDTH } from './transmissionLayout.ts'
import { VSM_TRANSMISSION_EDGE_WGSL } from './transmissionGeometryWgsl.ts'
import {
  BLOCK_SHIFT,
  EDGE_SLACK,
  HEADER_SHIFT,
  HEADER_TEXELS,
  TEXTURED_BIT,
  VSM_T_BLOCK_AT_WGSL,
  VSM_TRANSMISSION_CELL,
  VSM_TRANSMISSION_CELLS,
  WIDTH_SHIFT,
} from './transmissionShared.ts'

/**
 * The read of every shadow consumer (`../lighting/direct/shadowWgsl.ts`): the memory at `binding`
 * (a one-texel stand-in without translucent casters), then `vsmTransmissionThrough` — what the
 * translucent triangles of the sample's page let through to the receiver, tested exactly: its cell
 * of the page where the sample `sm` falls, each listed triangle containing that point
 * (`vsmTInside`) and lying strictly toward the light from the receiver. Directional: the triangle's
 * position along the map's unit axis at the point, barycentric, against the receiver's, by more
 * than ε = 2⁻²⁰ of the larger (f32 rounds each about eight times: 2⁻²¹, doubled); local: the
 * fraction of the way from the receiver to the light where the ray meets the triangle's plane,
 * above ε = 2⁻²⁰ of the larger of |P| and |w| over |n·P|. The receiver is the located one
 * (`vsmLocate`), moved off its surface by the normal bias: a surface's own triangle is never
 * above it. Up to two crossings multiply in any order to the same bits; three or more multiply in
 * increasing distance (then by their quantised value), so the result is the same whatever the
 * list order.
 * Lists `vsmProjectionOf` and the maths library's `bilinear3`; reads its host's `VsmMapRead` (the
 * page sampling) and `vsm` uniform.
 */
export const vsmTransmissionReadWgsl = (binding: number) =>
  wgslBlock(
    `vsmTransmissionReadWgsl(${binding})`,
    [
      VSM_TRANSMISSION_EDGE_WGSL,
      VSM_T_BLOCK_AT_WGSL,
      bilinear3,
      VSM_PROJECTION_DATA_READ_WGSL,
      lowHalf,
      highHalf,
    ],
    `
@group(0) @binding(${binding}) var vsmTransmissionMemory:texture_2d_array<u32>;
fn vsmTLoad(t:vec2u)->vec4u{return textureLoad(vsmTransmissionMemory,t,0,0);}
/** The block of slice texel \`v\` from its first block \`b0\`, the chain read from the first block. */
fn vsmTBlock(b0:u32,v:u32)->u32{
 let j=v>>${BLOCK_SHIFT}u;
 var b=b0;
 if(j>0u){b=vsmTLoad(vsmTMemBlock(b0,${HEADER_TEXELS}u+(j>>2u)))[j&3u];}
 return b;
}
/** Slice texel \`v\` from its first block \`b0\`. */
fn vsmTRead(b0:u32,v:u32)->vec4u{
 return vsmTLoad(vsmTMemBlock(vsmTBlock(b0,v),v&${VSM_TRANSMISSION_BLOCK_TEXELS - 1}u));
}
/** Block \`b\`'s texel \`t\` below the page headers' rows, counted from the pool's pages. */
fn vsmTMemBlock(b:u32,t:u32)->vec2u{
 return vsmTBlockAt(b,t,(vsm.poolPages+${2 * VSM_TRANSMISSION_WIDTH - 1}u)>>${HEADER_SHIFT}u);
}
/** The two first blocks (dynamic, static) of physical page \`page\`: none both without translucent
 *  casters (the one-texel stand-in). */
fn vsmTransmissionBlocks(page:vec2u)->vec2u{
 if(textureDimensions(vsmTransmissionMemory).x<=1u){return vec2u(${NO_INDEX}u);}
 let index=page.y*vsm.poolPagesXY.x+page.x;
 let t=index>>1u;
 let w=vsmTLoad(vec2u(t&${VSM_TRANSMISSION_WIDTH - 1}u,t>>${WIDTH_SHIFT}u));
 return select(w.xy,w.zw,(index&1u)!=0u);
}
/** The receiver: the point on the page, and its position along the axis (directional) or its
 *  light-relative position (local). */
struct VsmTReceiver{p:vec2f,directional:bool,axis:vec3f,d:f32,at:vec3f,}
/** One crossing of record \`v\`: its distance from the receiver toward the light (+inf for none) and
 *  what it lets through. */
struct VsmTHit{distance:f32,key:f32,through:vec3f,}
fn vsmTHitOf(b0:u32,v:u32,r:VsmTReceiver)->VsmTHit{
 var none=VsmTHit(-1.0,0.0,vec3f(1.0));
 // The record's four texels lie in one block: records start on a multiple of four texels, and a
 // block holds a whole number of them. Its block is read from the chain once.
 let rb=vsmTBlock(b0,v);let rv=v&${VSM_TRANSMISSION_BLOCK_TEXELS - 1}u;
 let t0=bitcast<vec4f>(vsmTLoad(vsmTMemBlock(rb,rv)));let t1=bitcast<vec4f>(vsmTLoad(vsmTMemBlock(rb,rv+1u)));
 let a=t0.xy;let b=t0.zw;let c=t1.xy;
 if(!vsmTInside(a,b,c,r.p)){return none;}
 let t2=vsmTLoad(vsmTMemBlock(rb,rv+2u));
 var distance=0.0;
 if(r.directional){
  let hit=dot(vsmTWeights(a,b,c,r.p),vec3f(t1.zw,bitcast<f32>(t2.x)));
  distance=hit-r.d;
  if(!(distance>${EDGE_SLACK}*max(abs(hit),abs(r.d)))){return none;}
 }else{
  let n=vec3f(t1.zw,bitcast<f32>(t2.x));let w=bitcast<f32>(t2.y);
  let along=dot(n,r.at);
  if(along==0.0){return none;}
  distance=(along-w)/along;
  if(!(distance>${EDGE_SLACK}*max(length(r.at),abs(w))/abs(along))){return none;}
 }
 var q=t2.z;
 var through=vec3f(1.0);
 if((q&${TEXTURED_BIT}u)!=0u){
  // A textured caster: the four patch texels around the point, bilinear.
  let d=vsmTLoad(vsmTMemBlock(rb,rv+3u));
  let origin=vec2f(vec2i(vec2u(lowHalf(d.y),highHalf(d.y)))-vec2i(1));
  let size=vec2u(lowHalf(d.z),highHalf(d.z));
  let h=clamp(r.p-0.5-origin,vec2f(0.0),vec2f(size-vec2u(1u)));
  let i=vec2u(floor(h));let f=h-floor(h);
  let j=min(i+1u,size-vec2u(1u));
  let ta=vsmTPatch(b0,d.x,size.x,i);let tb=vsmTPatch(b0,d.x,size.x,vec2u(j.x,i.y));
  let tc=vsmTPatch(b0,d.x,size.x,vec2u(i.x,j.y));let td=vsmTPatch(b0,d.x,size.x,j);
  through=bilinear3(ta,tb,tc,td,f);
  q=0u;
 }else{through=1.0-unpack4x8unorm(q).rgb;}
 return VsmTHit(distance,f32(q&0xFFFFFFu),through);
}
fn vsmTPatch(b0:u32,first:u32,width:u32,t:vec2u)->vec3f{
 let word=first+t.y*width+t.x;
 return 1.0-unpack4x8unorm(vsmTRead(b0,word>>2u)[word&3u]).rgb;
}
/** Over slice \`b0\`'s cell list at the receiver: the crossings counted and multiplied in list order,
 *  and the least crossing ordered after \`after\` (distance, then key), its multiplicity and value. */
struct VsmTScan{count:u32,product:vec3f,next:vec2f,nextCount:u32,nextThrough:vec3f,}
fn vsmTLess(a:vec2f,b:vec2f)->bool{return a.x<b.x||(a.x==b.x&&a.y<b.y);}
fn vsmTScanSlice(b0:u32,r:VsmTReceiver,after:vec2f,scan:VsmTScan)->VsmTScan{
 var out=scan;
 let cell=min(vec2u(r.p/${VSM_TRANSMISSION_CELL}.0),vec2u(${VSM_TRANSMISSION_CELLS - 1}u));
 let index=cell.y*${VSM_TRANSMISSION_CELLS}u+cell.x;
 let header=vsmTRead(b0,index>>2u)[index&3u];
 let first=highHalf(header);let count=lowHalf(header);
 // Four entries a texel: each texel read once.
 var entries=vec4u(0u);
 for(var i=0u;i<count;i++){
  if((i&3u)==0u){entries=vsmTRead(b0,first+(i>>2u));}
  let v=entries[i&3u];
  let hit=vsmTHitOf(b0,v,r);
  if(hit.distance<0.0){continue;}
  out.count++;out.product=out.product*hit.through;
  let key=vec2f(hit.distance,hit.key);
  if(!vsmTLess(after,key)){continue;}
  if(out.nextCount==0u||vsmTLess(key,out.next)){out.next=key;out.nextCount=1u;out.nextThrough=hit.through;}
  else if(all(key==out.next)){out.nextCount++;}
 }
 return out;
}
fn vsmTScanPage(blocks:vec2u,r:VsmTReceiver,after:vec2f)->VsmTScan{
 var scan=VsmTScan(0u,vec3f(1.0),vec2f(0.0),0u,vec3f(1.0));
 if(blocks.x!=${NO_INDEX}u){scan=vsmTScanSlice(blocks.x,r,after,scan);}
 if(blocks.y!=${NO_INDEX}u){scan=vsmTScanSlice(blocks.y,r,after,scan);}
 return scan;
}
/** What the translucent casters let through to the receiver of sample \`sm\`: \`fromMap\` the
 *  receiver in the shifted space of the sample's map (local), \`fromEye\` + \`eye\` its world
 *  position (directional). The axis is the sample's own level's, as its records were binned. */
fn vsmTransmissionThrough(sm:VsmMapRead,fromMap:vec3f,fromEye:vec3f,eye:vec3f,directional:bool)->vec3f{
 let blocks=vsmTransmissionBlocks(sm.poolTexel>>vec2u(${floorLog2(VSM_PAGE_TEXELS)}u));
 if(all(blocks==vec2u(${NO_INDEX}u))){return vec3f(1.0);}
 let M=vsmProjectionOf(sm.handle).shiftedToMapUv;
 let axis=normalize(vec3f(M[0].z,M[1].z,M[2].z));
 let r=VsmTReceiver(vec2f(sm.poolTexel&vec2u(${VSM_PAGE_TEXELS - 1}u))+fract(sm.mapTexelPos),directional,axis,dot(fromEye,axis)+dot(eye,axis),fromMap);
 let first=vsmTScanPage(blocks,r,vec2f(-1.0));
 if(first.count<=2u){return first.product;}
 var through=vec3f(1.0);var done=0u;var after=vec2f(-1.0);
 for(var guard=0u;done<first.count&&guard<first.count;guard++){
  let s=vsmTScanPage(blocks,r,after);
  if(s.nextCount==0u){break;}
  for(var m=0u;m<s.nextCount;m++){through*=s.nextThrough;}
  done+=s.nextCount;after=s.next;
 }
 return through;
}
/** Whether sample \`sm\` lies in a page with a translucent slice. */
fn vsmTransmissionPaned(sm:VsmMapRead)->bool{
 return sm.valid&&any(vsmTransmissionBlocks(sm.poolTexel>>vec2u(${floorLog2(VSM_PAGE_TEXELS)}u))!=vec2u(${NO_INDEX}u));
}`,
  )
