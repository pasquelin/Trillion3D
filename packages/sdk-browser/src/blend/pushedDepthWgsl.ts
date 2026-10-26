import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { GRAPH_FLAG } from './graphWgsl.ts'

/**
 * THE DEPTH A TRANSPARENT FRAGMENT'S PIXEL DEPTH OFFSET MOVES IT TO, for the passes that write the
 * responsiveness a layer leaves (the responsiveness pass): the pass writes this depth in place of the
 * fragment's own, so that its depth test against the opaque scene is the test of the moved pixel — a
 * layer pushed behind the opaque surface leaves no mark. The colour passes keep the fragment's own
 * depth: the offset moves nothing that is drawn.
 *
 * The output (`BlendGraph.depth`, the world's units along the camera vector, a push away only) is
 * counted along the view axis: in a perspective view it is multiplied by the cosine of the pixel's ray
 * with the axis — the clip `w` over the distance to the eye — and added to `w`; the depth, which the
 * reversed projection makes `1/w` up to a constant, is then that constant over the new `w`, never
 * nearer than it was. In an orthographic view the depth is affine in the distance and the offset
 * takes off its gradient along the axis.
 */
export const BLEND_PUSHED_DEPTH_WGSL = wgslBlock(
  'BLEND_PUSHED_DEPTH_WGSL',
  [],
  `fn blendPushedDepth(in:VSOut,g:BlendGrads)->f32{
 let depth=in.position.z;
 if((g.graph.flags&${GRAPH_FLAG.depth}u)==0u){return depth;}
 let push=max(g.graph.depth,0.0);
 if(uni.camPos.w==0.0){
  let gradient=length(vec3f(uni.viewProj[0][2],uni.viewProj[1][2],uni.viewProj[2][2]));
  return clamp(depth-push*gradient,0.0,depth);
 }
 let w=1.0/in.position.w;
 let along=push*w/max(length(in.view-uni.eye.xyz),1.0e-6);
 return min(depth*w/(w+along),depth);
}`,
)
