/**
 * THE SCREEN SEGMENT OF A SHADOW RAY (`traceWgsl.ts`): the first stretch of every ray from its
 * receiver, sampled in the image's own depth, finer than any map there: four point samples
 * (`VSM_SCREEN_RAY_SAMPLES`) of the opaque depth along the ray, one
 * batch of independent reads, offset by the pixel's noise. The host declares the view `vsmView`;
 * `hiz` is the depth pyramid's group and first binding, whose level 0 is read.
 */
import { wgslBlock } from '../../../../../../math/src/wgsl/decl.ts'
import { clipToFramebuffer } from '../../../../../../math/src/wgsl/projection.ts'
import { hizDepthWgsl } from '../../../../visibility/hiz/gpu/pyramidTexture.ts'
import { VSM_SCREEN_RAY_SAMPLES } from '../constants.ts'

export const vsmScreenSegmentWgsl = (hiz: readonly [group: number, binding: number]) =>
  wgslBlock(
    `vsmScreenSegmentWgsl(${hiz.join(', ')})`,
    [hizDepthWgsl(hiz[0], hiz[1]), clipToFramebuffer],
    `
/** What the screen segment reads at its receiver, whatever the light (\`vsmScreenRayStart\`): its
 *  framebuffer position and its opaque depth. */
struct VsmScreenStart{start:vec3f,depth:f32,}
fn vsmScreenRayStart(rayOrigin:vec3f)->VsmScreenStart{
 let start=clipToFramebuffer(vsmView.shiftedToClip*vec4f(rayOrigin,1.0),vsmView.viewPixels.xy);
 return VsmScreenStart(start,hizOpaqueDepth(vec2i(floor(start.xy))));
}
/** The screen segment from the receiver \`rayOrigin\` read at \`s\` (\`vsmScreenRayStart\`):
 *  ${VSM_SCREEN_RAY_SAMPLES} samples of the opaque depth (\`hizOpaqueDepth\`) along the ray's length,
 *  the first at (\`dither\` + 0.5) of a step, each next a step further. A sample whose depth is the
 *  start pixel's own (an exact compare: point samples of one texture) is the receiver itself and
 *  skipped (one off the image reads its edge pixel, as a clamped sampler would); the first
 *  sample behind the depth ends the segment a step and a half back (declared: the map segment starts
 *  at the surface, never behind it), else the segment is the whole length. A transparent surface is
 *  no occluder here: the maps' transmission is its shadow. The map's segment starts where the
 *  screen's stopped. */
fn vsmScreenRayFrom(s:VsmScreenStart,rayOrigin:vec3f,rayDirection:vec3f,rayLength:f32,dither:f32)->f32{
 let size=vsmView.viewPixels.xy;
 let c1=vsmView.shiftedToClip*vec4f(rayOrigin+rayDirection*rayLength,1.0);
 let d=clipToFramebuffer(c1,size)-s.start;
 let step=1.0/${VSM_SCREEN_RAY_SAMPLES}.0;
 var time=(dither+0.5)*step;
 for(var i=0u;i<${VSM_SCREEN_RAY_SAMPLES}u;i++){
  let p=s.start+d*time;
  let depth=hizOpaqueDepth(vec2i(floor(p.xy)));
  if(depth!=s.depth&&p.z<depth){return rayLength*max(0.0,time-1.5*step);}
  time+=step;
 }
 return rayLength;
}
`,
  )
