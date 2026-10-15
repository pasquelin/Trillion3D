/**
 * THE SCREEN SEGMENT OF A SHADOW RAY (`traceWgsl.ts`): the first stretch of every ray from its
 * receiver, marched through the image's own depth, finer than any map there. The host declares the
 * view `vsmView`; `hiz` is the depth pyramid's group and first binding.
 */
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { clipToFramebuffer } from '../../../math/src/wgsl/projection.ts'
import { SCREEN_MARCH_WGSL } from '../gpu/hiz/screenMarch.ts'

export const vsmScreenSegmentWgsl = (hiz: readonly [group: number, binding: number]) =>
  wgslBlock(
    `vsmScreenSegmentWgsl(${hiz.join(', ')})`,
    [SCREEN_MARCH_WGSL(hiz[0], hiz[1]), clipToFramebuffer],
    `
/** The screen segment: the engine's screen march (\`screenMarch\`, \`gpu/hiz/screenMarch.ts\`) of the
 *  depth along the ray's length, whose reach is the ray's own and whose thickness is \`thickness\`
 *  pixels of footprint — the ray's depth span, so that a surface nearer than the ray by more than it
 *  spans is no occluder of the point the ray leaves. The ray's length up to the first crossing, a
 *  pixel and a half back (declared: the map segment starts at the surface, never behind it), or the
 *  whole length where it meets nothing. A transparent surface is no occluder here: the maps'
 *  transmission is its shadow. */
fn vsmScreenRayCast(rayOrigin:vec3f,rayDirection:vec3f,rayLength:f32,thickness:f32)->f32{
 let size=vsmView.viewPixels.xy;
 let start=clipToFramebuffer(vsmView.shiftedToClip*vec4f(rayOrigin,1.0),size);
 let stop=clipToFramebuffer(vsmView.shiftedToClip*vec4f(rayOrigin+rayDirection*rayLength,1.0),size);
 let d=stop-start;
 let hit=screenMarch(start,d,screenMarchEnd(start.xy,d.xy,size),thickness,vsmView.screenSlab,0xffffffffu);
 if(hit.t<0.0||hit.front){return rayLength;}
 return rayLength*max(0.0,hit.t-1.5/max(max(abs(d.x),abs(d.y)),1e-6));
}
`,
  )
