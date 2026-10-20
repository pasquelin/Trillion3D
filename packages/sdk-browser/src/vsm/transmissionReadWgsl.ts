import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { NO_INDEX } from '../../../math/src/constants.ts'
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
 * The translucent casters' memory and what a shadow ray's segment meets in one cell of a page — the
 * per-ray read (`transmissionRayWgsl.ts`) walks every cell a ray crosses and multiplies these.
 * The memory is at `binding` of `group` (a one-texel stand-in without translucent casters).
 *
 * A ray is a segment from its start `x0` to its far end `x1`, then the line from the far end to
 * the light: toward the sun along the map's axis (a directional map), toward the light's centre (a
 * local one) — what the opaque march reads past its far end, the stored depth of the far end's
 * texel. A listed triangle is met where that polyline crosses it, tested exactly:
 * - directional: the triangle's position along the map's unit axis (barycentric, `vsmTWeights`) less
 *   the ray's, `f`, affine along the segment in the page's texels; the segment crosses where `f`
 *   changes sign, the line past the far end where `f` is still above 0 there;
 * - local: the plane `n·x = w` in light-relative space (the light at the shifted origin), `g`; the
 *   segment crosses where `g` changes sign, the line to the light where `g` at the far end and at
 *   the light differ — never both: the second is read only where the segment crossed nothing.
 * A triangle the start lies on (|f| or |g| within ε = 2⁻²⁰ of the larger term, f32 rounding each
 * about eight times) is the receiver's own surface, never met. A crossing counts only inside the
 * triangle (`vsmTInside`) and inside the cell walked (half open: a point lies in one cell alone), on
 * a cube face only where the point is that face's (`vsmCubeFace`): each crossing of the polyline is
 * counted once, whatever cells and pages list its triangle. In one cell up to two crossings
 * multiply in any order to the same bits; three or more add their logarithms as integers
 * (`vsmTLogOf`, 2⁻¹⁶ steps), so the product is the same whatever the list order.
 * Lists `vsmProjectionOf` and the maths library's `bilinear3`; reads its host's `vsm` uniform.
 * `gated`: the host's pipeline alone says whether the frame holds translucent casters, by an
 * override (`VSM_TRANSMISSION`), which folds every read away where it does not (the projection's,
 * whose host binds the real memory exactly with the variant that reads it).
 */
export const vsmTransmissionReadWgsl = (binding: number, group = 0, gated = false) =>
  wgslBlock(
    `vsmTransmissionReadWgsl(${binding}, ${group}, ${gated})`,
    [
      VSM_TRANSMISSION_EDGE_WGSL,
      VSM_T_BLOCK_AT_WGSL,
      bilinear3,
      VSM_PROJECTION_DATA_READ_WGSL,
      lowHalf,
      highHalf,
    ],
    `
@group(${group}) @binding(${binding}) var vsmTransmissionMemory:texture_2d_array<u32>;
${
  gated
    ? `/** Whether the frame holds translucent casters' transmission: the pipeline the host chose for it. */
override VSM_TRANSMISSION:bool=true;
fn vsmTranslucentCasters()->bool{return VSM_TRANSMISSION;}`
    : `/** Whether the frame holds translucent casters' transmission: a one-texel stand-in otherwise. */
fn vsmTranslucentCasters()->bool{return textureDimensions(vsmTransmissionMemory).x>1u;}`
}
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
 if(!vsmTranslucentCasters()){return vec2u(${NO_INDEX}u);}
 let index=page.y*vsm.poolPagesXY.x+page.x;
 let t=index>>1u;
 let w=vsmTLoad(vec2u(t&${VSM_TRANSMISSION_WIDTH - 1}u,t>>${WIDTH_SHIFT}u));
 return select(w.xy,w.zw,(index&1u)!=0u);
}
/** A ray's segment as one page of one map reads it: its start and far end in the map's UV clip
 *  space (\`c0\`, \`c1\`, the map's transform being affine, every point of the segment their mix) and the
 *  page's texels of a map UV (\`uv·scale + offset\`, from the page's corner); directional, the two
 *  ends' positions along the map's unit axis toward the light (\`r\`, world, as the records hold)
 *  and their page texels (\`pA\`, \`pB\`, \`vsmTPageAt\`, set with the page); local, the two ends in
 *  the map's shifted frame (\`x0\`, \`x1\`), the start's distance from the light (\`x0Length\`) and
 *  the cube face walked (−1: a spot's one map). */
struct VsmTSegment{directional:bool,c0:vec4f,c1:vec4f,r:vec2f,x0:vec3f,x1:vec3f,x0Length:f32,face:i32,scale:f32,offset:vec2f,pA:vec2f,pB:vec2f,}
/** The page texel of the point of UV clip position \`c\`. */
fn vsmTPageAt(s:VsmTSegment,c:vec4f)->vec2f{return c.xy/c.w*s.scale+s.offset;}
/** What record \`v\`'s triangle lets through where the polyline of \`s\` crosses it inside \`cell\`, and
 *  whether it does. */
struct VsmTHit{met:bool,through:vec3f,}
fn vsmTHitOf(b0:u32,v:u32,s:VsmTSegment,cell:vec2u)->VsmTHit{
 let none=VsmTHit(false,vec3f(1.0));
 // The record's four texels lie in one block: records start on a multiple of four texels, and a
 // block holds a whole number of them. Its block is read from the chain once.
 let rb=vsmTBlock(b0,v);let rv=v&${VSM_TRANSMISSION_BLOCK_TEXELS - 1}u;
 let t0=bitcast<vec4f>(vsmTLoad(vsmTMemBlock(rb,rv)));let t1=bitcast<vec4f>(vsmTLoad(vsmTMemBlock(rb,rv+1u)));
 let t2=vsmTLoad(vsmTMemBlock(rb,rv+2u));
 let a=t0.xy;let b=t0.zw;let c=t1.xy;
 var p=vec2f(0.0);var met=false;
 if(s.directional){
  let d=vec3f(t1.zw,bitcast<f32>(t2.x));
  let pA=s.pA;let pB=s.pB;
  let h0=dot(vsmTWeights(a,b,c,pA),d);
  let f0=h0-s.r.x;
  if(!(abs(f0)>${EDGE_SLACK}*max(abs(h0),abs(s.r.x)))){return none;}
  let f1=dot(vsmTWeights(a,b,c,pB),d)-s.r.y;
  if((f0>0.0)!=(f1>0.0)){p=mix(pA,pB,f0/(f0-f1));met=true;}
  else if(f1>0.0){p=pB;met=true;}
 }else{
  let n=vec3f(t1.zw,bitcast<f32>(t2.x));let w=bitcast<f32>(t2.y);
  let g0=dot(n,s.x0)-w;let g1=dot(n,s.x1)-w;
  if(!(abs(g0)>${EDGE_SLACK}*max(s.x0Length,abs(w)))){return none;}
  var t=1.0;
  if((g0>0.0)!=(g1>0.0)){t=g0/(g0-g1);met=true;}
  // Toward the light every point of the line keeps the far end's UV.
  else if((g1>0.0)!=(-w>0.0)){met=true;}
  if(!met||(s.face>=0&&i32(vsmCubeFace(mix(s.x0,s.x1,t)))!=s.face)){return none;}
  let cx=mix(s.c0,s.c1,t);
  if(!(cx.w>0.0)){return none;}
  p=vsmTPageAt(s,cx);
 }
 if(!met||any(p<vec2f(0.0))||any(p>=vec2f(${VSM_PAGE_TEXELS}.0))){return none;}
 if(any(vec2u(p/${VSM_TRANSMISSION_CELL}.0)!=cell)||!vsmTInside(a,b,c,p)){return none;}
 let q=t2.z;
 if((q&${TEXTURED_BIT}u)==0u){return VsmTHit(true,1.0-unpack4x8unorm(q).rgb);}
 // A textured caster: the four patch texels around the point, bilinear.
 let e=vsmTLoad(vsmTMemBlock(rb,rv+3u));
 let origin=vec2f(vec2i(vec2u(lowHalf(e.y),highHalf(e.y)))-vec2i(1));
 let size=vec2u(lowHalf(e.z),highHalf(e.z));
 let h=clamp(p-0.5-origin,vec2f(0.0),vec2f(size-vec2u(1u)));
 let i=vec2u(floor(h));let f=h-floor(h);
 let j=min(i+1u,size-vec2u(1u));
 let ta=vsmTPatch(b0,e.x,size.x,i);let tb=vsmTPatch(b0,e.x,size.x,vec2u(j.x,i.y));
 let tc=vsmTPatch(b0,e.x,size.x,vec2u(i.x,j.y));let td=vsmTPatch(b0,e.x,size.x,j);
 return VsmTHit(true,bilinear3(ta,tb,tc,td,f));
}
fn vsmTPatch(b0:u32,first:u32,width:u32,t:vec2u)->vec3f{
 let word=first+t.y*width+t.x;
 return 1.0-unpack4x8unorm(vsmTRead(b0,word>>2u)[word&3u]).rgb;
}
/** A crossing's transmittance as a sum term: −log2 of it in 1/65536 steps, at most 60 (2⁻⁶⁰, no
 *  light): integers add in any order to the same sum. */
fn vsmTLogOf(t:vec3f)->vec3u{return vec3u(round(min(-log2(max(t,vec3f(8.67361738e-19))),vec3f(60.0))*65536.0));}
/** What the triangles of the page whose slices are \`blocks\` let through along \`s\` inside \`cell\`,
 *  one pass over its lists: up to two crossings multiplied (in any order, the same bits), three or
 *  more through the sum of their logarithms (\`vsmTLogOf\`), the same whatever the lists' order. */
fn vsmTCellThrough(blocks:vec2u,s:VsmTSegment,cell:vec2u)->vec3f{
 var count=0u;var product=vec3f(1.0);var logSum=vec3u(0u);
 // The first two crossings, whose logarithms join the sum once a third comes.
 var hitA=vec3f(1.0);var hitB=vec3f(1.0);
 let index=cell.y*${VSM_TRANSMISSION_CELLS}u+cell.x;
 for(var k=0u;k<2u;k++){
  let b0=select(blocks.x,blocks.y,k==1u);
  if(b0==${NO_INDEX}u){continue;}
  let header=vsmTRead(b0,index>>2u)[index&3u];
  let first=highHalf(header);let n=lowHalf(header);
  // Four entries a texel: each texel read once.
  var entries=vec4u(0u);
  for(var i=0u;i<n;i++){
   if((i&3u)==0u){entries=vsmTRead(b0,first+(i>>2u));}
   let hit=vsmTHitOf(b0,entries[i&3u],s,cell);
   if(!hit.met){continue;}
   count++;
   if(count<=2u){
    product*=hit.through;
    if(count==1u){hitA=hit.through;}else{hitB=hit.through;}
    continue;
   }
   if(count==3u){logSum=vsmTLogOf(hitA)+vsmTLogOf(hitB);}
   logSum+=vsmTLogOf(hit.through);
  }
 }
 return select(exp2(-vec3f(logSum)/65536.0),product,count<=2u);
}`,
  )
