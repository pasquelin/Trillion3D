import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { CAMERA_MOTION_WGSL } from './nearestSurfaceWgsl.ts'
import { REPROJECTION_FIELD_WGSL } from './reprojectionFieldWgsl.ts'
import { TILE_CLAMP_WGSL } from './tileWgsl.ts'
import { CLOSEST_TEXEL_WGSL, REPROJECTION_VECTOR_WGSL } from './velocityWgsl.ts'

/**
 * THE REPROJECTION TO THE FRAME A PIXEL MAY BE RESURRECTED FROM, from this frame's clip space at
 * this eye to that frame's (`view.toResurrection`, `writeTaaView`):
 * - `resurrectionPoint`: the place the point at `screen` and depth `z` has in that frame's screen;
 * - `resurrectionField`: the reprojection vector of a texel and its jacobian — how that vector
 *   changes a pixel along each axis, in render pixels, from the derivatives of the point's place
 *   there by its place here —, the history update's for a pixel resurrected (`rejectionWgsl.ts`).
 */
export const RESURRECTION_WGSL = wgslBlock(
  'RESURRECTION_WGSL',
  [
    REPROJECTION_FIELD_WGSL,
    REPROJECTION_VECTOR_WGSL,
    CAMERA_MOTION_WGSL,
    CLOSEST_TEXEL_WGSL,
    TILE_CLAMP_WGSL,
  ],
  `
fn resurrectionPoint(screen:vec2f,z:f32)->vec3f{
 let there=view.toResurrection*transformHomogeneousPoint(view.invViewProj,vec3f(screen,z));
 return vec3f(there.xy/there.w,1.0/there.w);
}
struct TaaResurrection{vector:vec2f,jacobian:TaaJacobian}
fn resurrectionField(screen:vec2f,z:f32)->TaaResurrection{
 let there=resurrectionPoint(screen,z);
 let m=view.toResurrection*view.invViewProj;
 let toPixel=vec2f(view.render.x*0.5,-view.render.y*0.5);
 let toScreen=vec2f(2.0,-2.0)*view.render.zw;
 let j0=-toPixel*vec2f(m[0][0],m[0][1])*toScreen.x*there.z+toPixel*vec2f(toScreen.x,0.0);
 let j1=-toPixel*vec2f(m[1][0],m[1][1])*toScreen.y*there.z+toPixel*vec2f(0.0,toScreen.y);
 return TaaResurrection(screen-there.xy,TaaJacobian(j0,j1));
}`,
)
