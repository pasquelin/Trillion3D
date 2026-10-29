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
import {
  coneSolidAngle,
  sampleCone,
  sampleConeLocal,
} from '../../../../math/src/wgsl/coneSampling.ts'
import {
  buildSphericalRect,
  sampleSphericalRect,
  sphericalRectInversePdf,
} from '../../../../math/src/wgsl/sphericalRect.ts'
import { PI } from '../../../../math/src/wgsl/constants.ts'
import { DIRECT_LIGHT_WGSL } from '../direct/lightWgsl.ts'
import { lightTraits } from '../direct/lightReachWgsl.ts'
import { RAY_MAX_DISTANCE } from './lightSamplerWgsl.ts'

/** `sqrtOneMinus(x)`: the root of one less `x`, a series where `x` is small. */
const SQRT_ONE_MINUS_WGSL = wgslBlock(
  'SAMPLED_SQRT_ONE_MINUS_WGSL',
  [],
  `fn sqrtOneMinus(x:f32)->f32{return select(sqrt(1.0-x),1.0-x*(0.5+x*0.125),x<0.01);}`,
)

export const LIGHT_TRACE_WGSL = wgslBlock(
  'SAMPLED_LIGHT_TRACE_WGSL',
  [
    DIRECT_LIGHT_WGSL,
    lightTraits,
    buildSphericalRect,
    sampleSphericalRect,
    sphericalRectInversePdf,
    coneSolidAngle,
    sampleConeLocal,
    sampleCone,
    SQRT_ONE_MINUS_WGSL,
    PI,
  ],
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
  let rect=buildSphericalRect(centre+translate*a1,a0,a1,a2,vec2f(rectRadius,0.5*len+extend));
  let r0=centre+translate*a1-a1*(0.5*len+extend);
  let r1=centre+translate*a1+a1*(0.5*len+extend);
  let inv0=inverseSqrt(dot(r0,r0));
  let inv1=inverseSqrt(dot(r1,r1));
  let coneAxis=normalize(mix(r0,r1,saturate(inv1/(inv0+inv1))));
  let sin2=saturate(0.5-0.5*dot(r0,r1)*inv0*inv1);
  if(coneSolidAngle(sin2)<rect.solid){direction=sampleCone(e,sin2,coneAxis,false).xyz;}
  else{direction=sampleSphericalRect(e,rect).direction;}
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
  let r=buildSphericalRect(toLight,a0,a1,n,vec2f(length(u),light.shape.w));
  let s=sampleSphericalRect(uv,r);
  return select(centre,vec4f(s.direction,s.distance),dot(s.direction,n)>=0.0);
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
