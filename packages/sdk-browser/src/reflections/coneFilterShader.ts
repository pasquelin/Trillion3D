import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { tangentAround } from '../../../math/src/wgsl/basis.ts'
import { clipToUvUnflipped } from '../../../math/src/wgsl/projection.ts'

/** Up to four mip cells enclose a cone section; integrate their covered areas.
 * The depth range rejects empty or disjoint cells, rather than treating the
 * farthest occlusion depth as a first-hit boundary.
 * - `reflectionReceiverPlane`: the receiver's plane on the screen, from its point's projection `c`
 *   (`q0` in pixels, depth `z0`) and its normal `N` — a plane's depth is affine there: `x` its depth at `q0`,
 *   `yz` its change per pixel, `w` one, or none (all zero) where the plane is seen edge on.
 * - `reflectionConeMeets`: whether a cell may hold what the cone meets within `limits`. A cell
 *   whose nearest depth is no nearer than the receiver's plane anywhere over it lies on or behind
 *   the receiver: no direction of the lobe above it reaches there, and the cone, which starts on
 *   the receiver, would otherwise take its own surface for a hit — the whole lobe then read the
 *   receiver back. Nearer is a greater depth, the clear depth being zero; within the plane's own
 *   rounding, eight units of f32's last place, a cell counts as on it.
 *   The plane is taken over the cell where it is nearest — the receiver's own cells drop out — or,
 *   `sure`, where it is farthest: only what lies wholly behind it drops out, as a block the walk
 *   passes whole must.
 * - `reflectionConeCell`: the covered share of a section's cells, or, not `covered`, whether any
 *   of them may hold a hit (one, else none) — the test a coarser block passes whole by. */
export const REFLECTION_CONE_FILTER_WGSL = wgslBlock(
  'REFLECTION_CONE_FILTER_WGSL',
  [tangentAround, clipToUvUnflipped],
  `
fn reflectionReceiverPlane(c:vec4f,N:vec3f,q0:vec2f,z0:f32)->vec4f{
 let T:vec3f=tangentAround(N);let B:vec3f=cross(N,T);
 let offset:f32=0.01*abs(c.w);
 let c1:vec4f=c+reflectionProject(vec4f(T,0.0))*offset;
 let c2:vec4f=c+reflectionProject(vec4f(B,0.0))*offset;
 if(c1.w<=0.0||c2.w<=0.0){return vec4f(0.0);}
 let size:vec2f=reflectionSize();
 let d1:vec2f=clipToUvUnflipped(c1)*size-q0;let e1:f32=c1.z/c1.w-z0;
 let d2:vec2f=clipToUvUnflipped(c2)*size-q0;let e2:f32=c2.z/c2.w-z0;
 let det:f32=d1.x*d2.y-d1.y*d2.x;
 if(abs(det)<1e-6){return vec4f(0.0);}
 let g:vec2f=vec2f(e1*d2.y-e2*d1.y,d1.x*e2-d2.x*e1)/det;
 return vec4f(z0,g,1.0);
}
fn reflectionConeMeets(pixel:vec2i,level:i32,side:f32,limits:vec2f,receiver:vec4f,q0:vec2f,sure:bool)->bool{
 let range:vec2f=reflectionBoundsAt(pixel,level);
 if(!(range.x<=range.y&&range.x<=limits.y&&range.y>=limits.x)){return false;}
 if(receiver.w!=1.0){return true;}
 // The cell's own extent: the last of a level also covers the screen's tail.
 let size:vec2f=reflectionSize();
 let begin:vec2f=vec2f(pixel)*side;var end:vec2f=begin+vec2f(side);
 if((f32(pixel.x)+2.0)*side>size.x){end.x=size.x;}
 if((f32(pixel.y)+2.0)*side>size.y){end.y=size.y;}
 let planeDepth:f32=receiver.x+dot(receiver.yz,(begin+end)*0.5-q0);
 var slack:f32=0.5*dot(abs(receiver.yz),end-begin);
 if(sure){slack=-slack;}
 return max(range.x,range.y)>planeDepth+slack+abs(planeDepth)*exp2(-20.0);
}
fn reflectionConeCell(at:vec2f,footprint:vec2f,level:i32,limits:vec2f,receiver:vec4f,q0:vec2f,covered:bool)->vec4f{
 let side:f32=exp2(f32(level));
 let radius:vec2f=max(footprint,vec2f(0.5));
 let low:vec2f=max(at-radius,vec2f(0.0));
 let high:vec2f=min(at+radius,reflectionSize());
 let origin:vec2i=vec2i(floor(low/side));
 let total:f32=4.0*radius.x*radius.y;
 var sum:vec4f=vec4f(0.0);
 for(var y:i32=0;y<2;y++){
  for(var x:i32=0;x<2;x++){
   let pixel:vec2i=origin+vec2i(x,y);
   let begin:vec2f=vec2f(pixel)*side;
   let overlap:vec2f=max(vec2f(0.0),min(high,begin+vec2f(side))-max(low,begin));
   let area:f32=overlap.x*overlap.y;
   if(area>0.0&&reflectionConeMeets(pixel,level,side,limits,receiver,q0,!covered)){
    if(!covered){return vec4f(1.0);}
    sum+=reflectionMipColorAt(pixel,level)*area;
   }
  }
 }
 if(!covered){return vec4f(0.0);}
 return sum/max(total,1.0);
}`,
)
