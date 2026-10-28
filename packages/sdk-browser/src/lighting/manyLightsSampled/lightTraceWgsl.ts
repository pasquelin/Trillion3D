/**
 * WHERE ON A LIGHT A SAMPLE'S RAY GOES (`lightSampleTrace`): from a point `P` toward the point of the light the sample's place `uv` (two numbers of
 * the blue noise, six bits each in the ray word) picks, its direction (`xyz`, unit) and its distance (`w`). Every pass that traces a sample's ray —
 * the screen's, the virtual shadow maps', the scene's — reads this one segment, so that they agree on where the light is.
 * - a point light is its centre;
 * - a sphere is sampled by solid angle: the cone it fills from the point, by a concentric map of the disk, the ray ending at the sphere's near face
 *   (by area, over its whole surface, where the point is inside it);
 * - a sun is a cone about its direction, as far as a ray goes (`RAY_MAX_DISTANCE`);
 * - a rectangle is sampled over the spherical rectangle it makes from the point (uniform in solid angle; by area where that is tiny), a sample
 *   behind it invalid;
 * - a tube is sampled by solid angle over the smaller of the rectangle and the cone that bound it, a sample that misses the tube invalid.
 * An invalid sample is replaced by the light's centre, as a sample the draw cannot lose must still estimate a shadow (forcing it occluded would add noise
 * where nothing is shadowed, forcing it visible would leak light where something is).
 */
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { frameAround, outOfFrame } from '../../../../math/src/wgsl/basis.ts'
import { PI } from '../../../../math/src/wgsl/constants.ts'
import { uniformDiskConcentric } from '../../../../math/src/wgsl/sampling.ts'
import { DIRECT_LIGHT_WGSL } from '../direct/lightWgsl.ts'
import { lightTraits } from '../direct/lightReachWgsl.ts'
import { RAY_MAX_DISTANCE } from './lightSamplerWgsl.ts'

/** The rectangle projected on the sphere around the point, with the coefficients of its sampling. */
const SPHERICAL_RECT_WGSL = wgslBlock(
  'SAMPLED_SPHERICAL_RECT_WGSL',
  [PI],
  `struct SphRect{a0:vec3f,a1:vec3f,a2:vec3f,x0:f32,x1:f32,y0:f32,y1:f32,z0:f32,b0:f32,b1:f32,k:f32,solid:f32,}
/** The arcsine, fitted to stay exact near 1 where a distant rectangle's angles lie. */
fn sphRectAsin(x:f32)->f32{
 var a=saturate(abs(x));
 let inner=a<0.5;
 let a2=select(0.5-0.5*a,a*a,inner);
 a=select(sqrt(a2),a,inner);
 var r=0.100323;
 r=r*a2+0.163288;
 r=(r*a2+1.00011)*a;
 r=select(1.57079632679-2.0*r,r,inner);
 return select(r,-r,x<0.0);
}
/** The rectangle of centre 'origin' (from the point), axes 'a0', 'a1' and normal 'a2', half sizes 'extent', seen from the point. */
fn buildSphRect(origin:vec3f,a0:vec3f,a1:vec3f,a2:vec3f,extent:vec2f)->SphRect{
 let local=vec3f(dot(a0,origin),dot(a1,origin),dot(a2,origin));
 var r:SphRect;
 r.a0=a0;r.a1=a1;r.a2=select(a2,-a2,local.z>0.0);
 r.x0=local.x-extent.x;r.x1=local.x+extent.x;
 r.y0=local.y-extent.y;r.y1=local.y+extent.y;
 r.z0=-abs(local.z);
 let z0sq=local.z*local.z;
 let n0=-r.y0*inverseSqrt(z0sq+r.y0*r.y0);
 let n1=r.x1*inverseSqrt(z0sq+r.x1*r.x1);
 let n2=r.y1*inverseSqrt(z0sq+r.y1*r.y1);
 let n3=-r.x0*inverseSqrt(z0sq+r.x0*r.x0);
 let g01=sphRectAsin(n0*n1)+sphRectAsin(n1*n2);
 let g23=sphRectAsin(n2*n3)+sphRectAsin(n3*n0);
 r.b0=n0;r.b1=n2;r.k=g23;r.solid=g01+g23;
 return r;
}
/** The direction (xyz) and distance (w) of the point of the spherical rectangle 'e' picks, uniform in solid angle, or in area where the angle is tiny; 'solid' in the
 *  result's second use is read by the capsule's choice. */
fn sampleSphRect(e:vec2f,r:SphRect)->vec4f{
 var xu:f32;var yv:f32;
 if(r.solid>1e-3){
  let au=e.x*r.solid-r.k;
  let fu=(cos(au)*r.b0+r.b1)/sin(au);
  var cu=inverseSqrt(fu*fu+r.b0*r.b0)*select(-1.0,1.0,fu>0.0);
  cu=clamp(cu,-1.0,1.0);
  xu=clamp(-(cu*r.z0)*inverseSqrt(max(1.0-cu*cu,1e-30)),r.x0,r.x1);
  let d2=xu*xu+r.z0*r.z0;
  let h0=r.y0*inverseSqrt(d2+r.y0*r.y0);
  let h1=r.y1*inverseSqrt(d2+r.y1*r.y1);
  let hv=h0+e.y*(h1-h0);
  let rv=1.0-hv*hv;
  yv=select(r.y1,hv*d2*inverseSqrt(rv*d2),rv>0.0);
 }else{
  xu=mix(r.x0,r.x1,e.x);
  yv=mix(r.y0,r.y1,e.y);
 }
 let d=xu*r.a0+yv*r.a1+r.z0*r.a2;
 let dist2=xu*xu+yv*yv+r.z0*r.z0;
 let inv=inverseSqrt(dist2);
 return vec4f(d*inv,dist2*inv);
}
fn coneSolidAngle(sin2:f32)->f32{
 return 2.0*PI*select(1.0-sqrt(1.0-sin2),sin2*(0.5+0.125*sin2),sin2<0.01);
}
fn sqrtOneMinus(x:f32)->f32{return select(sqrt(1.0-x),1.0-x*(0.5+x*0.125),x<0.01);}`,
)

/** A direction in the cone of half angle 'sin2' (the square of its sine) about 'axis': uniform in solid angle, by a concentric map when 'concentric'. */
const CONE_WGSL = wgslBlock(
  'SAMPLED_CONE_WGSL',
  [frameAround, outOfFrame, uniformDiskConcentric, PI],
  `fn sampleCone(e:vec2f,sin2:f32,axis:vec3f,concentric:bool)->vec4f{
 let oneMinusCos=select(1.0-sqrt(1.0-sin2),sin2*(0.5+0.125*sin2),sin2<0.01);
 var local:vec3f;
 if(concentric){
  let disk=uniformDiskConcentric(e)*sqrt(sin2);
  local=vec3f(disk,sqrt(max(1.0-dot(disk,disk),0.0)));
 }else{
  let phi=2.0*PI*e.x;
  let cosTheta=1.0-oneMinusCos*e.y;
  let sinTheta=sqrt(max(1.0-cosTheta*cosTheta,0.0));
  local=vec3f(sinTheta*cos(phi),sinTheta*sin(phi),cosTheta);
 }
 return vec4f(outOfFrame(local,frameAround(axis)),1.0/(2.0*PI*oneMinusCos));
}`,
)

export const LIGHT_TRACE_WGSL = wgslBlock(
  'SAMPLED_LIGHT_TRACE_WGSL',
  [DIRECT_LIGHT_WGSL, lightTraits, SPHERICAL_RECT_WGSL, CONE_WGSL, uniformDiskConcentric, PI],
  `/** The distance to a capsule of axis 'axis', radius squared 'r2' and length 'len' centred at 'centre' along the ray 'rd' (approximate), negative on a miss. */
fn capsuleTest(rd:vec3f,centre:vec3f,axis:vec3f,r2:f32,len:f32)->f32{
 let b=dot(rd,axis);
 let t=clamp(dot(centre,b*rd-axis)/max(1.0-b*b,1e-8),-0.5*len,0.5*len);
 let toSphere=centre+t*axis;
 let c=cross(rd,toSphere);
 return select(-1.0,length(toSphere),dot(c,c)<=r2);
}
/** A direction toward a capsule: sampled over the smaller of the rectangle and the cone that bound it. The direction (xyz) and 0, or w -1 where the capsule is missed. */
fn sampleCapsule(centre:vec3f,axis:vec3f,radiusIn:f32,len:f32,e:vec2f)->vec4f{
 let radius=max(radiusIn,0.01);
 let r2=radius*radius;
 let h=dot(axis,centre);
 let onAxis=centre-axis*h;
 let toAxis2=dot(onAxis,onAxis);
 var direction:vec3f;
 if(toAxis2<=r2){
  // Inside the infinite cylinder only one cap shows.
  let cap=centre-axis*len*0.5*sign(h);
  direction=sampleCone(e,saturate(r2/dot(cap,cap)),normalize(cap),false).xyz;
 }else{
  let a2=normalize(-onAxis);
  let a1=axis;
  let a0=cross(a1,a2);
  let sinCylinder=radius*inverseSqrt(toAxis2);
  let rectRadius=radius*inverseSqrt(1.0-sinCylinder*sinCylinder);
  var extension=array<f32,2>(0.0,0.0);
  for(var i=0;i<2;i++){
   let hi=len*select(-0.5,0.5,i>0);
   let p=centre+axis*hi;
   let invDist=inverseSqrt(dot(p,p));
   let sinSphere=saturate(radius*invDist);
   let cosSphere=sqrtOneMinus(sinSphere*sinSphere);
   var cosAxis=-dot(axis,p)*invDist;
   cosAxis=sign(cosAxis*hi)*saturate(abs(cosAxis));
   let sinAxis=sqrtOneMinus(cosAxis*cosAxis);
   extension[i]=radius/(sinAxis*cosSphere+cosAxis*sinSphere);
  }
  let translate=0.5*(extension[1]-extension[0]);
  let extend=0.5*(extension[0]+extension[1]);
  let rect=buildSphRect(centre+translate*a1,a0,a1,a2,vec2f(rectRadius,0.5*len+extend));
  let r0=centre+translate*a1-a1*(0.5*len+extend);
  let r1=centre+translate*a1+a1*(0.5*len+extend);
  let inv0=inverseSqrt(dot(r0,r0));
  let inv1=inverseSqrt(dot(r1,r1));
  let coneAxis=normalize(mix(r0,r1,saturate(inv1/(inv0+inv1))));
  let sin2=saturate(0.5-0.5*dot(r0,r1)*inv0*inv1);
  if(coneSolidAngle(sin2)<rect.solid){direction=sampleCone(e,sin2,coneAxis,false).xyz;}
  else{direction=sampleSphRect(e,rect).xyz;}
 }
 return vec4f(direction,capsuleTest(direction,centre,axis,r2,len));
}
fn lightSampleTrace(rank:u32,P:vec3f,uv:vec2f)->vec4f{
 let light=directLights.items[rank];
 let toLight=light.positionRange.xyz-P;
 let centre=vec4f(normalize(toLight),length(toLight));
 if(isSun(light)){
  let s=sourceTermOf(light);
  return vec4f(sampleCone(uv,s*s,-light.directionCone.xyz,false).xyz,${RAY_MAX_DISTANCE}.0);
 }
 if(isRect(light)){
  let u=light.shape.xyz;
  let n=light.directionCone.xyz;
  let a0=normalize(u);
  let a1=normalize(cross(u,n));
  let r=buildSphRect(toLight,a0,a1,n,vec2f(length(u),light.shape.w));
  let s=sampleSphRect(uv,r);
  return select(centre,s,dot(s.xyz,n)>=0.0);
 }
 let radius=light.shape.x;
 if(tubeHalfLengthOf(light)>0.0){
  let c=sampleCapsule(toLight,light.capsule.xyz,radius,2.0*tubeHalfLengthOf(light),uv);
  return select(centre,vec4f(c.xyz,c.w),c.w>0.0);
 }
 if(radius<=0.0){return centre;}
 let r2=radius*radius;
 let d2=dot(toLight,toLight);
 if(d2<=r2){
  // The point is inside the sphere: a point of its surface, uniform in area.
  let z=1.0-2.0*uv.y;let phi=2.0*PI*uv.x;let rr=sqrt(max(1.0-z*z,0.0));
  let onSphere=toLight+vec3f(rr*cos(phi),rr*sin(phi),z)*radius;
  let len=length(onSphere);
  return vec4f(onSphere/len,len);
 }
 let sin2=r2/d2;
 let cone=sampleCone(uv,sin2,normalize(toLight),true);
 let cosT=dot(cone.xyz,normalize(toLight));
 let sinT2=1.0-cosT*cosT;
 return vec4f(cone.xyz,sqrt(d2)*(cosT-sqrt(max(sin2-sinT2,0.0))));
}`,
)
