import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { PT_LIGHTS_WGSL } from './lightsWgsl.ts'

/**
 * THE STRETCH OF A RAY A LAMP LIGHTS IN A VOLUME (`PtVolumeSetup`, `ptPrepareVolumeLight(id, origin, direction, tMin, tMax)`): the part of `tMin` to `tMax` that lies in the lamp's reach (the sphere of its range, none being unbounded), cut for a spot by its
 * cone (the ray's overlap with the infinite cone of its outer angle) and for a rectangle by the plane of its face (pushed a millimetre forward, so that no sample lies on the light), with an estimate of the light the lamp gives along it
 * (`importance`, the brightest channel of its colour, a rectangle's times its area, a spot's by the cone's value at the point of the ray nearest its axis, times the length the stretch takes in the angle the lamp is seen under). A lamp that falls off by the inverse square is sampled
 * with a density that follows the inverse square of the distance to its centre (equi-angular: the angle seen from the centre is drawn evenly, `ptVolumeDistance`), the others evenly in length. `ptVolumeDistance(setup, e)` is the distance drawn
 * for `e` and the density of that choice along the ray. A ray through the lamp's centre has no angle to draw: it is drawn evenly (the reference divides by zero there). A lamp the ray does not meet, and the lamps at infinity, give none (`ptVolumeValid`).
 */
export const PT_VOLUME_LIGHT_WGSL = wgslBlock(
  'PT_VOLUME_LIGHT_WGSL',
  [PT_LIGHTS_WGSL],
  `struct PtVolumeSetup{tMin:f32,tMax:f32,importance:f32,t0:f32,height:f32,thetaMin:f32,thetaMax:f32,k:f32,}
fn ptVolumeValid(s:PtVolumeSetup)->bool{return s.tMin<s.tMax;}
fn ptVolumeUniform(importance:f32,tMin:f32,tMax:f32)->PtVolumeSetup{
 return PtVolumeSetup(tMin,tMax,importance*(tMax-tMin),0.0,-1.0,0.0,0.0,tMax-tMin);
}
fn ptVolumeEquiAngular(importance:f32,centre:vec3f,ro:vec3f,rd:vec3f,tMin:f32,tMax:f32)->PtVolumeSetup{
 let v=centre-ro;
 let height=length(cross(v,rd));
 if(!(height>0.0)){return ptVolumeUniform(importance,tMin,tMax);}
 let t0=dot(v,rd);
 let thetaMin=atan((tMin-t0)/height);
 let thetaMax=atan((tMax-t0)/height);
 return PtVolumeSetup(tMin,tMax,importance*(thetaMax-thetaMin)/height,t0,height,thetaMin,thetaMax,(thetaMax-thetaMin)*height);
}
fn ptVolumeDistance(s:PtVolumeSetup,e:f32)->vec2f{
 if(s.height>0.0){
  let tanTheta=tan(mix(s.thetaMin,s.thetaMax,e));
  return vec2f(s.height*tanTheta+s.t0,1.0/((1.0+tanTheta*tanTheta)*s.k));
 }
 return vec2f(mix(s.tMin,s.tMax,e),1.0/s.k);
}
fn ptRaySphereOverlap(ro:vec3f,rd:vec3f,centre:vec3f,radius:f32,tMin:f32,tMax:f32)->vec2f{
 let oc=ro-centre;
 let b=dot(oc,rd);
 let d=oc-b*rd;
 let h=radius*radius-dot(d,d);
 if(h>0.0){
  let s=sqrt(h);
  return vec2f(max(-b-s,tMin),min(-b+s,tMax));
 }
 return vec2f(-1.0);
}
fn ptRayConeOverlap(ro:vec3f,rd:vec3f,apex:vec3f,axis:vec3f,cosTheta:f32)->vec2f{
 let ba=axis*cosTheta;
 let oa=ro-apex;
 let m0=dot(ba,ba);
 let m1=dot(oa,ba);
 let m3=dot(rd,ba);
 let m4=dot(rd,oa);
 let m5=dot(oa,oa);
 let k2=m0*m0-m3*m3;
 let k1=m0*m0*m4-m1*m3;
 let k0=m0*m0*m5-m1*m1;
 let h=k1*k1-k2*k0;
 if(h>0.0){
  let s=sign(k2);
  let t=(-k1+vec2f(-s,s)*sqrt(h))/k2;
  let y=m1+t*m3;
  let c=select(0,1,y.x>0.0)+select(0,2,y.y>0.0);
  if(c==1){return vec2f(0.0,t.x);}
  if(c==2){return vec2f(t.y,PT_T_MAX);}
  if(c==3){return t;}
 }
 return vec2f(-1.0);
}
fn ptClipRayByPlane(ro:vec3f,rd:vec3f,n:vec3f,c:vec3f,t:ptr<function,vec2f>){
 let d=dot(rd,n);
 let plane=dot(c-ro,n)/d;
 if(d>0.0){(*t).x=max((*t).x,plane);}
 if(d<0.0){(*t).y=min((*t).y,plane);}
}
fn ptPrepareVolumeLight(id:u32,ro:vec3f,rd:vec3f,tMin:f32,tMax:f32)->PtVolumeSetup{
 let light=directLights.lights[id];
 let kind=ptLightKind(id);
 var none:PtVolumeSetup;
 if(kind!=PT_LIGHT_POINT&&kind!=PT_LIGHT_SPOT&&kind!=PT_LIGHT_RECT){return none;}
 let centre=light.position.xyz;
 let reach=select(1.0e18,light.colour.w,light.colour.w>0.0);
 var t=ptRaySphereOverlap(ro,rd,centre,reach,tMin,tMax);
 if(!(t.x<t.y)){return none;}
 let colour=light.colour.xyz;
 var importance=max(colour.x,max(colour.y,colour.z));
 if(kind==PT_LIGHT_RECT){
  let n=light.axis.xyz;
  ptClipRayByPlane(ro,rd,n,centre+n*0.001,&t);
  importance*=light.size.x*light.size.y;
 }
 if(kind==PT_LIGHT_SPOT){
  let n=light.axis.xyz;
  let cone=ptRayConeOverlap(ro,rd,centre,n,light.size.z);
  if(!(cone.x<cone.y)){return none;}
  t=vec2f(max(cone.x,t.x),min(cone.y,t.y));
  // The point of the ray where the cone's value is the largest, which keeps a ray through the edge of the cone from being left out.
  let q=centre-ro;
  let a=dot(q,n);
  let b=dot(rd,n);
  let denominator=b*dot(q,rd)-a;
  // A ray parallel to the axis has no nearest point: the cone's value at the lamp's centre stands for it.
  if(denominator!=0.0){
   let nearest=(b*dot(q,q)-a*dot(q,rd))/denominator;
   importance*=ptSpotCone(light,normalize((q-rd*nearest)*sign(denominator)));
  }
 }
 if(light.shares.z>0.0){return ptVolumeUniform(importance,t.x,t.y);}
 return ptVolumeEquiAngular(importance,centre,ro,rd,t.x,t.y);
}`,
)
