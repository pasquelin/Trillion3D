import { COVERAGE_SCALE_GLSL } from '../../texture/coverageRule.ts'

/** The GLSL twin of the WebGPU reduction (`MIP_SHADER`, `../../texture/mipsWgsl.ts`) under `weighted`;
 *  `source` is a copy of the level above, `extent` its size; with a `cutoff`, the row under it
 *  holds the level's `t` (`coverageMips.ts`). */
export const MIP_FRAGMENT_GLSL = `#version 300 es
precision highp float;precision highp int;
uniform highp sampler2D source;
uniform ivec2 extent;
uniform uint cutoff;
out vec4 color;
${COVERAGE_SCALE_GLSL}
void main(){
 ivec2 p=ivec2(gl_FragCoord.xy)*2;ivec2 hi=extent-1;
 vec4 s0=texelFetch(source,min(p,hi),0);vec4 s1=texelFetch(source,min(p+ivec2(1,0),hi),0);
 vec4 s2=texelFetch(source,min(p+ivec2(0,1),hi),0);vec4 s3=texelFetch(source,min(p+ivec2(1,1),hi),0);
 vec4 mean=(s0+s1+s2+s3)*0.25;vec4 a=vec4(s0.a,s1.a,s2.a,s3.a);
 vec3 byAlpha=(s0.rgb*s0.a+s1.rgb*s1.a+s2.rgb*s2.a+s3.rgb*s3.a)/dot(a,vec4(1.0));
 uint t=cutoff>0u?toByte(texelFetch(source,ivec2(0,extent.y),0).a):0u;
 color=vec4(any(notEqual(a,vec4(s0.a)))?byAlpha:mean.rgb,reducedAlpha(a,cutoff,t));
}`
