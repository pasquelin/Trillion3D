import { COVERAGE_CUT_GLSL, COVERAGE_SCALE_GLSL } from '../../texture/coverageRule.ts'

/** Four points per texel of a level, one per filtered sample of its square (`cutBin`), its alpha
 *  bytes level 0's own or a level's medians from the copy of the one above (`halved`): on the
 *  column of its bin, row `texel & 15` of the level's sixteen, channel `quarter` — no cell passes
 *  2^24 samples, where a float stops counting. */
export const COVERAGE_COUNT_GLSL = `#version 300 es
uniform highp sampler2D source;uniform ivec2 extent;uniform ivec2 size;uniform bool halved;uniform uint cutoff;
flat out uint quarter;
${COVERAGE_SCALE_GLSL}
${COVERAGE_CUT_GLSL}
uint alphaAt(ivec2 p){
 p=min(p,size-1);
 if(!halved)return toByte(texelFetch(source,p,0).a);
 ivec2 q=p*2;ivec2 hi=extent-1;
 return median(vec4(texelFetch(source,min(q,hi),0).a,texelFetch(source,min(q+ivec2(1,0),hi),0).a,
  texelFetch(source,min(q+ivec2(0,1),hi),0).a,texelFetch(source,min(q+ivec2(1,1),hi),0).a));
}
void main(){
 int texel=gl_VertexID>>2;ivec2 p=ivec2(texel%size.x,texel/size.x);quarter=uint(gl_VertexID&3);
 uvec4 a=uvec4(alphaAt(p),alphaAt(p+ivec2(1,0)),alphaAt(p+ivec2(0,1)),alphaAt(p+ivec2(1,1)));
 gl_Position=vec4((float(cutBin(a,quarter,cutoff))+.5)/128.-1.,(float(texel&15)+.5)/8.-1.,0.,1.);gl_PointSize=1.;
}`
