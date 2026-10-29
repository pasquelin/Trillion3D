import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { PI, TWO_PI } from '../../../../math/src/wgsl/constants.ts'
import { GGX_DISTRIBUTION_WGSL } from '../standardLighting.ts'

/**
 * THE DIELECTRIC INTERFACE OF THE PATH TRACER'S GLASS: a rough boundary between two media of relative index `eta` (the index of the medium entered over that left: the
 * material's index on a front face, its inverse on a back face), reflecting and refracting by the Fresnel term, in the local frame where the normal is +z and `v`
 * points to the eye.
 *
 * `ptSampleRefraction` draws between reflection and refraction at a given half vector by the Fresnel reflectance (the dielectric's own, total internal reflection reflecting
 * all, or the artist's `f0` for the reflection and the bending of the refraction): it returns the direction, the reflectance of the branch taken and whether it refracted.
 * `ptGlassSample(v, alpha, eta, f0, e)` draws a half vector from the visible normals (unbounded, so that a refracted direction may lie under the horizon), takes that branch
 * and returns the direction, the weight (the visible-normal estimator `G2/G1` of the branch: the Fresnel term is in the density, so cancels), the density of the direction and
 * whether it refracted. `ptGlassEval(l, v, alpha, eta, f0)` is the weight and density of a direction given, on its side of the surface. `ptGgxEvalRefraction` is the
 * transmission lobe's weight and density through a half vector. A smooth surface (alpha at its floor) keeps the same code; the specular lobe is as narrow as the
 * floor lets it.
 */
export const PT_DIELECTRIC_WGSL = wgslBlock(
  'PT_DIELECTRIC_WGSL',
  [PI, TWO_PI, GGX_DISTRIBUTION_WGSL],
  `struct PtRefraction{direction:vec3f,fresnel:f32,refracted:bool,}
struct PtGlass{direction:vec3f,weight:f32,pdf:f32,refracted:bool,}
fn ptFresnelDielectric(cosI:f32,eta:f32,f0:f32)->f32{
 let g2=eta*eta-1.0+cosI*cosI;
 if(g2<0.0){return 1.0;}
 let c=select(sqrt(g2)/eta,cosI,eta>=1.0);
 let f90=saturate(f0*50.0);
 let k=1.0-c;
 let k2=k*k;
 return mix(f0,f90,k2*k2*k);
}
fn ptSampleRefraction(d:vec3f,n:vec3f,eta:f32,f0:f32,r:f32)->PtRefraction{
 var out:PtRefraction;
 let cosI=abs(dot(d,n));
 let g2=eta*eta-1.0+cosI*cosI;
 if(g2>=0.0){
  let fr=ptFresnelDielectric(cosI,eta,f0);
  if(r>=fr){
   out.fresnel=1.0-fr;
   out.direction=normalize(d+n*(cosI-sqrt(g2)));
   out.refracted=true;
   return out;
  }
  out.fresnel=fr;
 }else{out.fresnel=1.0;}
 out.direction=d+(2.0*cosI)*n;
 out.refracted=false;
 return out;
}
fn ptVisibleGgxHalfUnbounded(e:vec2f,alpha:f32,v:vec3f)->vec3f{
 let seen=normalize(vec3f(alpha*v.xy,v.z));
 let z=1.0-e.y*(1.0+seen.z);
 let sine=sqrt(saturate(1.0-z*z));
 let phi=TWO_PI*e.x;
 let h=vec3f(sine*cos(phi),sine*sin(phi),z)+seen;
 let stretched=vec3f(alpha*h.xy,max(0.0,h.z));
 return select(vec3f(0.0,0.0,1.0),normalize(stretched),dot(stretched,stretched)>0.0);
}
fn ptGgxEvalReflectionUnbounded(l:vec3f,v:vec3f,h:vec3f,alpha:f32)->vec2f{
 let nol=saturate(l.z);
 let nov=saturate(v.z);
 if(nol>0.0&&nov>0.0){
  let d=ggxDistribution(alpha*alpha,h.z,dot(h.xy,h.xy));
  let lenL=length(vec3f(l.xy*alpha,nol));
  let lenV=length(vec3f(v.xy*alpha,nov));
  return vec2f(nol*(lenV+nov)/(nov*lenL+nol*lenV),0.5*d/(lenV+nov));
 }
 return vec2f(0.0);
}
fn ptGgxEvalRefraction(l:vec3f,v:vec3f,h:vec3f,alpha:f32,eta:f32)->vec2f{
 let nov=saturate(v.z);
 let nol=saturate(-l.z);
 if(nol>0.0&&nov>0.0&&h.z>0.0){
  let d=ggxDistribution(alpha*alpha,h.z,dot(h.xy,h.xy));
  let voh=saturate(dot(v,h));
  let loh=saturate(-dot(l,h));
  let lenL=length(vec3f(l.xy*alpha,nol));
  let lenV=length(vec3f(v.xy*alpha,nov));
  let weight=nol*(lenV+nov)/(nov*lenL+nol*lenV);
  let q=voh-eta*loh;
  let pdf=(loh*voh*eta*eta*2.0*d)/(max(q*q,1e-12)*(lenV+nov));
  return vec2f(weight,max(pdf,0.0));
 }
 return vec2f(0.0);
}
fn ptGlassSample(v:vec3f,alpha:f32,eta:f32,f0:f32,e:vec3f)->PtGlass{
 var out:PtGlass;
 let h=ptVisibleGgxHalfUnbounded(e.xy,alpha,v);
 let s=ptSampleRefraction(-v,h,eta,f0,e.z);
 out.direction=s.direction;
 out.refracted=s.refracted;
 let ggx=select(ptGgxEvalReflectionUnbounded(s.direction,v,h,alpha),ptGgxEvalRefraction(s.direction,v,h,alpha,eta),s.refracted);
 out.weight=ggx.x;
 out.pdf=s.fresnel*ggx.y;
 return out;
}
fn ptGlassEval(l:vec3f,v:vec3f,alpha:f32,eta:f32,f0:f32)->vec2f{
 if(l.z>0.0){
  let h=normalize(v+l);
  let ggx=ptGgxEvalReflectionUnbounded(l,v,h,alpha);
  let f=ptFresnelDielectric(saturate(dot(v,h)),eta,f0);
  return vec2f(ggx.x,f*ggx.y);
 }
 if(l.z<0.0){
  let ht0=-(eta*l+v);
  let ht=normalize(select(ht0,-ht0,eta<1.0));
  let f=1.0-ptFresnelDielectric(saturate(dot(v,ht)),eta,f0);
  if(f>0.0){
   let ggx=ptGgxEvalRefraction(l,v,ht,alpha,eta);
   return vec2f(ggx.x,ggx.y*f);
  }
 }
 return vec2f(0.0);
}`,
)
