import { DEPTH_CLEAR, DEPTH_NEAR } from '../../camera/depthConvention.ts';
import { wgslFloat } from '../partition/margins.ts';

/**
 * What a visibility-buffer pixel receives, and the resolve of two triangles that fall at exactly
 * the same depth.
 *
 * **The resolve.** WebGPU has no sixty-four-bit atomic: one cannot write in one go "this depth
 * AND this identifier". Two passes do it without a lock and without depending on thread order:
 *
 * 1. every class writes its depth by `atomicMax` on the IEEE-754 bits — for a positive depth
 *    those bits grow with the value, and engine depth is REVERSE-Z (1 at the near plane, 0 at
 *    infinity), so the integer maximum is the nearest;
 * 2. every class rereads the now-final depth and, for the only triangle whose depth is EXACTLY
 *    that, writes its identifier by `atomicMin`.
 *
 * `max` and `min` are commutative and associative: the result depends neither on thread order,
 * nor on dispatch order, nor on the class split. And since the identifier is
 * `(row+1)<<8 | triangle`, the minimum is the smallest row rank, then the smallest triangle:
 * at equal depth, the winner is always the same, from frame to frame and from machine to
 * machine. This is the only place the frame can differ from a hardware raster, which resolves
 * by submission order.
 *
 * The cluster's coplanar layer is an integer offset on the depth key, applied before packing:
 * in reverse-Z, ADDING units brings closer by exactly that many last bits, capped at the near-
 * plane bits. Zero for layer 0.
 *
 * **Coverage is watertight.** A pixel is covered when its three edge functions have the sign of
 * the area — never by derived weights, whose division and \`1-w0-w1\` round enough to leave a
 * shared-edge pixel to nobody, or to accept one far from a clip sliver. Each edge is evaluated
 * in the CANONICAL order of its two vertices, hence with the same operands in the same order
 * for the two triangles that share it: they read the same value up to sign, and a pixel exactly
 * on the edge goes to the one of the two whose interior is on the positive side of the
 * canonical sense — a top-left rule, one owner. The same three values make the weights,
 * normalised on their sum: a weight that does not sum to one shifts the whole depth of a flat
 * surface, enough to lose a coplanar-layer resolve.
 */
export const RASTER_PIXEL_WGSL = `
/** Canonical order of two screen vertices: highest first, then leftmost. */
fn canonBefore(a:vec2f,b:vec2f)->bool{return a.y<b.y||(a.y==b.y&&a.x<b.x);}
/** \`edge(a,b,p)\` computed in canonical order: both triangles of an edge read the same bits. */
fn canonEdge(a:vec2f,b:vec2f,p:vec2f,before:bool)->f32{
 if(before){return edge(a,b,p);}
 return -edge(b,a,p);
}
/** True when edge \`a→b\` value \`e\` leaves the pixel on the interior side of a triangle of area \`area\`. */
fn edgeCovers(e:f32,before:bool,inside:bool)->bool{
 if(e==0.0){return before==inside;}
 return (e>0.0)==inside;
}
/** Barycentric weights of the pixel in triangle \`(a,b,c)\` if it covers it; \`w<0\`: no. */
fn coverTri(a:vec2f,b:vec2f,c:vec2f,area:f32,p:vec2f)->vec4f{
 let bc=canonBefore(b,c);let ca=canonBefore(c,a);let ab=canonBefore(a,b);
 let e0=canonEdge(b,c,p,bc);let e1=canonEdge(c,a,p,ca);let e2=canonEdge(a,b,p,ab);
 let inside=area>0.0;
 if(area==0.0||!edgeCovers(e0,bc,inside)||!edgeCovers(e1,ca,inside)||!edgeCovers(e2,ab,inside)){return vec4f(0.0,0.0,0.0,-1.0);}
 return vec4f(vec3f(e0,e1,e2)/(e0+e1+e2),1.0);
}
/** Weights of the pixel in the sub-triangle that covers it, and which one; \`w<0\`: none. */
fn coverAt(t:Tri,sample:vec2f)->vec4f{
 let first=coverTri(t.a,t.b,t.c,t.area0,sample);
 if(first.w>=0.0){return vec4f(first.xyz,0.0);}
 if(t.quad!=0u){
  let second=coverTri(t.a,t.c,t.d,t.area1,sample);
  if(second.w>=0.0){return vec4f(second.xyz,1.0);}
 }
 return vec4f(0.0,0.0,0.0,-1.0);
}
fn rasterPixel(t:Tri,pixel:vec2i,writeId:bool){
 // The only frame bound of the whole raster: thread tiles overshoot the triangle box as soon as
 // it is not a round count, and the box is already clamped to the last pixel of the frame.
 // Without this bound, a triangle at the right or bottom edge wraps its writes onto the next
 // row, even out of the identifier plane, where they overwrite the triangle-list header.
 if(pixel.x>i32(t.hi.x)||pixel.y>i32(t.hi.y)){return;}
 let sample=vec2f(pixel)+vec2f(0.5);
 let cov=coverAt(t,sample);
 if(cov.w<0.0){return;}
 var qb=t.cb;var qc=t.cc;var nb=t.ub;var nc=t.uc;
 if(cov.w>0.5){qb=t.cc;qc=t.cd;nb=t.uc;nc=t.ud;}
 let wa=cov.x;let wb=cov.y;let wc=cov.z;
 let depth=wa*t.ca.z/t.ca.w+wb*qb.z/qb.w+wc*qc.z/qc.w;
 // The far plane is infinite: depth falls toward far without ever reaching it.
 if(depth<=${wgslFloat(DEPTH_CLEAR)}||depth>${wgslFloat(DEPTH_NEAR)}){return;}
 let page=pages[t.row];
 if((page.flags&128u)!=0u){
  let inv=wa/t.ca.w+wb/qb.w+wc/qc.w;
  let tc=(t.ua*(wa/t.ca.w)+nb*(wb/qb.w)+nc*(wc/qc.w))/inv;
  // Hard cutout at level 0 unless the image accumulates; then the stipple at the footprint.
  var gx=vec2f(0.0);var gy=vec2f(0.0);var stipple=0.0;
  if(uni.stipple!=0u){
   let second=cov.w>0.5;
   let g=uvGradients(t.a,select(t.b,t.c,second),select(t.c,t.d,second),sample,t.ua.xy,nb.xy,nc.xy,1.0/vec3f(t.ca.w,qb.w,qc.w));
   gx=g[0];gy=g[1];stipple=stippleOffset(sample);
  }
  if(!maskKeep(page,tc.xy,tc.z,gx,gy,stipple)){return;}
 }
 let offset=u32(pixel.y)*u32(uni.viewport.x)+u32(pixel.x);
 let raw=bitcast<u32>(depth);
 let bits=min(bitcast<u32>(${wgslFloat(DEPTH_NEAR)}),raw+page.depthBias);
 if(writeId){if(atomicLoad(&work[offset])==bits){atomicMin(&work[pixelCount()+offset],page.packedBase|(t.triangle&0xffu));}}
 else{atomicMax(&work[offset],bits);}
}
`;
