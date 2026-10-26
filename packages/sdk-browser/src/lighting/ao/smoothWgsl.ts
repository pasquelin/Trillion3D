import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { FULLSCREEN_VERTEX } from '../../gpu/shader/fullscreenTriangle.ts'
import { AO_COMMON_WGSL } from './commonWgsl.ts'

/**
 * THE SMOOTHING OF THE COMPUTE PASS (`aoSmooth`): each pixel the mean of four texels of the result — its own, the one two to
 * its right, the one two below and the one two across both — a box over the noise's 4 × 4 grid, the texels past the drawn
 * rectangle's edge taken as its last. It is made where the compute pass is, and the image does not accumulate in time,
 * which would smooth the grid itself.
 */
export const AO_SMOOTH_WGSL = wgslProgram(
  `
fn aoSmoothTap(p:vec2i,offset:vec2i)->f32{
 let last=vec2i(view.rects.xy)-vec2i(1);
 return textureLoad(lowerAo,min(p+offset,last),0).r;
}
@fragment fn aoSmooth(@builtin(position) at:vec4f)->@location(0) vec4f{
 let p=vec2i(floor(at.xy));
 let sum=aoSmoothTap(p,vec2i(0,0))+aoSmoothTap(p,vec2i(2,0))+aoSmoothTap(p,vec2i(0,2))+aoSmoothTap(p,vec2i(2,2));
 return vec4f(sum*0.25,0.0,0.0,1.0);
}`,
  [AO_COMMON_WGSL, FULLSCREEN_VERTEX],
)
