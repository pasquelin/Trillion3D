import { LANCZOS2_GLSL } from '../../taa/lanczos2Wgsl.ts'

/**
 * WebGL2's resample of an image drawn below the display, per DISPLAY pixel: the upscale of the
 * temporal resolve without its history, since WebGL2 keeps none (`../../taa/upscaleWgsl.ts`). The
 * display pixel's place in the render grid is `r = uv · render − 0.5`, texel centres at integers;
 * the 3×3 render texels around it weigh by Lanczos-2 of their distance to `r`, no jitter, and the
 * sum is clamped to the 2×2 nearest texels, where the kernel's negative lobes ring. The depth is
 * the nearest texel's, so what is drawn over the image after (`world.guides`) is hidden as before.
 * `untoned`: the effect chain's second attachment (`CLUSTER_LINEAR_FRAGMENT`) resampled alike.
 */
export const resampleFragment = (untoned: boolean) => {
  const both = (text: string) => (untoned ? text : '')
  return `#version 300 es
precision highp float;precision highp sampler2D;
uniform sampler2D image,depth${both(',untoned')};uniform ivec2 render;uniform vec2 display;
layout(location=0) out vec4 color;${both('layout(location=1) out vec4 untonedOut;')}
${LANCZOS2_GLSL}
void main(){vec2 r=gl_FragCoord.xy/display*vec2(render)-0.5;
ivec2 base=ivec2(floor(r+0.5)),low=ivec2(floor(r)),last=render-ivec2(1);
vec4 sum=vec4(0.0),lo=vec4(1e9),hi=vec4(-1e9);float total=0.0;
${both('float share=0.0,shareLo=1.0,shareHi=0.0;')}
for(int dy=-1;dy<=1;dy++)for(int dx=-1;dx<=1;dx++){ivec2 tap=base+ivec2(dx,dy),at=clamp(tap,ivec2(0),last);
vec4 s=texelFetch(image,at,0);float w=lanczos2(length(vec2(at)-r));sum+=s*w;total+=w;
${both('float u=texelFetch(untoned,at,0).r;share+=u*w;')}
ivec2 ring=tap-low;if(all(greaterThanEqual(ring,ivec2(0)))&&all(lessThanEqual(ring,ivec2(1)))){lo=min(lo,s);hi=max(hi,s);
${both('shareLo=min(shareLo,u);shareHi=max(shareHi,u);')}}}
color=clamp(sum/max(total,1e-4),lo,hi);
${both('untonedOut=vec4(clamp(share/max(total,1e-4),shareLo,shareHi),0.0,0.0,color.a);')}
gl_FragDepth=texelFetch(depth,clamp(base,ivec2(0),last),0).r;}`
}
