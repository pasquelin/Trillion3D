import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { GGX_DISTRIBUTION_WGSL } from '../standardLighting.ts'

/**
 * THE LOBES THE PATH TRACER'S SLABS SHARE: `ptGgxEval(l, v, h, alpha)` is the weight (`x`) and the density (`y`) of a direction `l` through the half vector `h` of the specular lobe of width
 * `alpha`, seen from `v` in the shading frame; `ptShadowTerminator(l, n, vertexNormal)` softens a lobe where the shading normal and the vertex normal disagree (the microfacet shadowing of the bump terminator problem).
 */
export const PT_LOBE_WGSL = wgslBlock(
  'PT_LOBE_WGSL',
  [GGX_DISTRIBUTION_WGSL],
  `fn ptGgxEval(l:vec3f,v:vec3f,h:vec3f,alpha:f32)->vec2f{
 let nol=saturate(l.z);
 let nov=saturate(v.z);
 if(nol>0.0&&nov>0.0){
  let d=ggxDistribution(alpha*alpha,h.z,dot(h.xy,h.xy));
  let lenL=length(vec3f(l.xy*alpha,nol));
  let lenV=length(vec3f(v.xy*alpha,nov));
  let a=saturate(alpha);
  let s=1.0+length(v.xy);
  let k=(s*s-a*a*s*s)/(s*s+a*a*nov*nov);
  return vec2f(nol*(lenV+k*nov)/(nov*lenL+nol*lenV),0.5*d/(lenV+k*nov));
 }
 return vec2f(0.0);
}
fn ptShadowTerminator(l:vec3f,n:vec3f,vertexNormal:vec3f)->f32{
 let epsilon=1e-6;
 let cosD=saturate(abs(dot(vertexNormal,n)));
 let alpha2=saturate(0.125*(1.0-cosD*cosD)/(cosD*cosD+epsilon));
 let cosI=saturate(dot(vertexNormal,l));
 let tan2I=(1.0-cosI*cosI)/(cosI*cosI+epsilon);
 return select(0.0,2.0/(1.0+sqrt(1.0+alpha2*tan2I)),cosI>0.0);
}`,
)
