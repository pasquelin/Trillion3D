import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { FULLSCREEN_VERTEX } from '../deferred/shaders.ts'
import { AO_COMMON_WGSL } from './commonWgsl.ts'

/**
 * THE SETUP OF A COARSER RESOLUTION (`aoSetup`): a pixel of the half or of the quarter takes four of the
 * scene's surfaces — the pixels a quarter of its size either side of its centre, so the two adjacent ones at the
 * half and every other one at the quarter —, keeps the farthest of their depths, and averages their normals
 * (as `normal · ½ + ½`) weighed by how near each depth is to that farthest: `1 − |Δ| · threshold`, the
 * threshold the setting over the pass's scale per centimetre, held between 0 and 1. The depth is stored over the
 * half-float scale (`AO_DEPTH_SCALE`) in the alpha. Taps past the image take its last pixel.
 */
export const AO_SETUP_WGSL = wgslProgram(
  `
fn aoSetupTap(at:vec2f)->vec4f{
 let pixel=clamp(vec2i(floor(at)),vec2i(0),vec2i(ao.lens.zw)-vec2i(1));
 return vec4f(aoSurfaceNormal(pixel)*0.5+vec3f(0.5),aoSceneDepth(pixel));
}
fn aoSetupWeight(tap:vec4f,farthest:f32)->vec4f{
 return vec4f(tap.xyz,1.0)*saturate(1.0-abs(tap.w-farthest)*ao.fade.z);
}
@fragment fn aoSetup(@builtin(position) at:vec4f)->@location(0) vec4f{
 let scale=ao.radius.z;
 let centre=(floor(at.xy)+vec2f(0.5))*scale;
 let reach=0.25*scale;
 let a=aoSetupTap(centre+vec2f(-reach,-reach));
 let b=aoSetupTap(centre+vec2f(reach,-reach));
 let c=aoSetupTap(centre+vec2f(-reach,reach));
 let d=aoSetupTap(centre+vec2f(reach,reach));
 let farthest=max(max(a.w,b.w),max(c.w,d.w));
 let sum=vec4f(0.0001)+aoSetupWeight(a,farthest)+aoSetupWeight(b,farthest)+aoSetupWeight(c,farthest)+aoSetupWeight(d,farthest);
 return vec4f(sum.xyz/sum.w,farthest/AO_DEPTH_SCALE);
}`,
  [AO_COMMON_WGSL, FULLSCREEN_VERTEX],
)
