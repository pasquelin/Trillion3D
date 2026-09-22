import { FINE_SPAN, LARGE_SPAN, TILE } from './gpuRasterContract.ts';

/**
 * What a triangle decides before a pixel is named, and the only writing of that compute: binning
 * evaluates it once per triangle, the raster passes replay it for the survivors only, from the
 * same inputs. The set that reaches a pixel is therefore the one a per-pixel evaluation would
 * have reached.
 *
 * The split with the hardware raster is read first, by the predicate both rasters share
 * (`computeTakes`): a triangle hardware keeps costs only its three vertices here. For those
 * compute takes:
 *
 * - **The box is clipped to the viewport instead of being rejected.** A triangle that overshoots
 *   the screen keeps the part of its box that falls in the frame, and it is on THAT part that
 *   its class is read. A triangle entirely off-screen has no box.
 * - **The near plane is clipped, not rejected** — under `COMPUTE_ALL` only, a threshold leaving
 *   those triangles to hardware. A vertex nearer than the near plane has no usable projection:
 *   one clips in clip space on the canonical plane `z <= w`, which IS the near plane since the
 *   projection sets `z_clip = near` and `w_clip = distance`. The clip yields three or four
 *   vertices, hence one or two sub-triangles; texture coordinates follow, otherwise a mask
 *   material's cutout would not be the same on both sides of the plane. The written identifier
 *   remains that of the original triangle: hardware resolve rebuilds its attributes from its
 *   unclipped vertices.
 */
export const RASTER_TRI_WGSL = `
struct Clip{n:u32,p:array<vec4f,4>,u:array<vec2f,4>,}
fn clipNear(pa:vec4f,pb:vec4f,pc:vec4f,ua:vec2f,ub:vec2f,uc:vec2f)->Clip{
 var inP=array<vec4f,3>(pa,pb,pc);
 var inU=array<vec2f,3>(ua,ub,uc);
 var res:Clip;res.n=0u;
 for(var i=0u;i<3u;i=i+1u){
  let j=(i+1u)%3u;
  let cur=inP[i];let nxt=inP[j];
  // Signed distance to the near plane: positive in front, zero on the plane, negative behind.
  let dc=cur.w-cur.z;let dn=nxt.w-nxt.z;
  let curIn=dc>=0.0;let nxtIn=dn>=0.0;
  if(curIn){res.p[res.n]=cur;res.u[res.n]=inU[i];res.n=res.n+1u;}
  if(curIn!=nxtIn){
   // The clip point is computed from the same vertex for the two triangles that share the
   // edge — the one in front of the plane —, otherwise two different roundings would open the clip.
   let fromCur=curIn;
   let p0=select(nxt,cur,fromCur);let p1=select(cur,nxt,fromCur);
   let u0=select(inU[j],inU[i],fromCur);let u1=select(inU[i],inU[j],fromCur);
   let d0=select(dn,dc,fromCur);let d1=select(dc,dn,fromCur);
   let t=d0/(d0-d1);
   // The clipped vertex is set back exactly on the plane: its \`w\` equals \`near\` to the bit,
   // no rounding can make it nearer than the near plane.
   var q=mix(p0,p1,t);q.w=q.z;
   res.p[res.n]=q;res.u[res.n]=mix(u0,u1,t);res.n=res.n+1u;
  }
 }
 return res;
}
struct Tri{ca:vec4f,cb:vec4f,cc:vec4f,cd:vec4f,
 a:vec2f,b:vec2f,c:vec2f,d:vec2f,ua:vec2f,ub:vec2f,uc:vec2f,ud:vec2f,lo:vec2f,hi:vec2f,
 ok:u32,row:u32,triangle:u32,quad:u32,area0:f32,area1:f32,}
fn setupTriangle(pageIndex:u32,triangle:u32,vp:mat4x4f,det:f32)->Tri{
 var t:Tri;t.ok=0u;t.row=pageIndex;t.triangle=triangle;t.quad=0u;
 let page=pages[pageIndex];
 if(uni.selectionEnabled!=0u&&selectionMask[uni.selectionOffset+page.selectionIndex]==0u){return t;}
 if(triangle*3u+2u>=page.indexCount){return t;}
 let h=pageHeader(page);
 let ia=pageCorner(page,h,triangle*3u);let ib=pageCorner(page,h,triangle*3u+1u);let ic=pageCorner(page,h,triangle*3u+2u);
 let ca=vertex(vp,page,h,ia);let cb=vertex(vp,page,h,ib);let cc=vertex(vp,page,h,ic);
 if(!computeTakes(ca,cb,cc)){return t;}
 // Only a mask material clips in the raster: it alone pays the read of its three UVs.
 var ua=vec2f(0.0);var ub=vec2f(0.0);var uc=vec2f(0.0);
 if((page.flags&128u)!=0u){ua=pageUv(page,h,ia);ub=pageUv(page,h,ib);uc=pageUv(page,h,ic);}
 let cl=clipNear(ca,cb,cc,ua,ub,uc);
 if(cl.n<3u){return t;}
 let a=screen(cl.p[0]);let b=screen(cl.p[1]);let c=screen(cl.p[2]);
 let area0=edge(a,b,c);
 var d=a;var ud=vec2f(0.0);var area1=0.0;
 if(cl.n==4u){d=screen(cl.p[3]);ud=cl.u[3];area1=edge(a,c,d);t.quad=1u;}
 // Orientation of the clipped polygon is that of the original triangle: on an unclipped
 // triangle, \`area0\` alone decides, to the bit as before.
 let orient=area0+area1;
 if(abs(orient)<1e-8){return t;}
 let front=select((orient>0.0),(orient<0.0),(det>=0.0));
 if((page.flags&2u)==0u){if((page.flags&256u)!=0u){if(front){return t;}}else if(!front){return t;}}
 var lo=min(a,min(b,c));var hi=max(a,max(b,c));
 if(cl.n==4u){lo=min(lo,d);hi=max(hi,d);}
 let box=boxOf(lo,hi);
 // A box entirely left or above the frame clamps onto the edge: clamping alone does not
 // distinguish it from a box that touches that edge; the UNCLAMPED box says so.
 let last=uni.viewport-vec2f(1.0);
 if(hi.x<0.0||hi.y<0.0||lo.x>last.x||lo.y>last.y){return t;}
 t.ok=1u;t.a=a;t.b=b;t.c=c;t.d=d;t.ca=cl.p[0];t.cb=cl.p[1];t.cc=cl.p[2];t.cd=select(cl.p[0],cl.p[3],cl.n==4u);
 t.ua=cl.u[0];t.ub=cl.u[1];t.uc=cl.u[2];t.ud=ud;
 t.area0=area0;t.area1=area1;t.lo=box.q0;t.hi=box.q1;
 return t;
}
/** Size class of an already-clipped box: the tile a thread group covers at once. */
fn triClass(t:Tri)->u32{
 let span=max(t.hi.x-t.lo.x,t.hi.y-t.lo.y);
 if(span<=f32(${FINE_SPAN}u)){return 0u;}
 if(span<=f32(${TILE}u-1u)){return 1u;}
 if(span<=f32(${LARGE_SPAN}u)){return 2u;}
 return 3u;
}
/** Eight-pixel tiles a box covers, in columns then in rows. */
fn tileCols(t:Tri)->u32{return u32(t.hi.x-t.lo.x)/${TILE}u+1u;}
fn tileRows(t:Tri)->u32{return u32(t.hi.y-t.lo.y)/${TILE}u+1u;}
`;
