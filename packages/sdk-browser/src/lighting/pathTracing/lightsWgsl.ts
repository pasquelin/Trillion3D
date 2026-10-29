import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { PI } from '../../../../math/src/wgsl/constants.ts'
import { luminance } from '../../../../math/src/wgsl/color.ts'
import { radialWindow, rangeWindow } from '../direct/lightReachWgsl.ts'
import { PT_LIGHT } from './lightRecords.ts'
import { PT_MONTE_CARLO_WGSL } from './monteCarloWgsl.ts'
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
import { frameAround, outOfFrame } from '../../../../math/src/wgsl/basis.ts'
import { PT_SKY_WGSL } from './skyWgsl.ts'

/** The length of a ray that goes to infinity: the sky and the suns are met by a ray of this length alone. */
export const PT_T_MAX = 1.0e30

/** The length of a ray that goes to infinity, as the shaders name it. */
export const PT_T_MAX_WGSL = wgslBlock('PT_T_MAX_WGSL', [], `const PT_T_MAX:f32=${PT_T_MAX};`)

/** A light's record as the shader reads it (`lightRecords.ts`, `PT_LIGHT_AT`): the place and kind, the axis, the colour and range, the tangent and radius, the sizes, the shares, the indirect factor. */
export const PT_LIGHT_STRUCT_WGSL = wgslBlock(
  'PT_LIGHT_STRUCT_WGSL',
  [],
  'struct PtLight{position:vec4f,axis:vec4f,colour:vec4f,tangent:vec4f,size:vec4f,shares:vec4f,extra:vec4f,}',
)

/**
 * THE PATH TRACER'S LIGHTS (`directLights.lights`, the records `lightRecords.ts` writes, seven `vec4f` each, after the energy table the materials read): for each kind the three things the integrator asks of it.
 *
 * - `ptTraceLight(origin, direction, tMin, tMax, id)`: whether a ray meets the light before `tMax`, with the radiance it sees and the density with which
 *   sampling the light would have chosen that direction (per solid angle) — the sky and the suns are met by a ray of length `PT_T_MAX` alone (a ray that
 *   escapes), a lamp with a source radius by the sphere of the source, a rectangle by its face;
 * - `ptSampleLight(id, e, point, normal)`: a point of the light seen from `point`, with the radiance over the density, the density, the direction and the
 *   distance — a sun's disk drawn evenly in its cone, a lamp's sphere in the cone it subtends (a lamp of no size is the point itself), a rectangle's face by area
 *   (the density turned to solid angle by the distance and the cosine at the face), the sky by the table (`ptSkySample`);
 * - `ptEstimateLight(id, point, normal)`: an upper bound of the irradiance the light gives, to pick the light to sample in proportion to it.
 * A lamp's radiance is weighed by its falloff (the range's window, or the other falloff's, taken at the distance of its centre so that every sample of it
 * agrees) and a spot's by its cone (the square of a ramp in the cosine).
 */
export const PT_LIGHTS_WGSL = wgslBlock(
  'PT_LIGHTS_WGSL',
  [
    PI,
    luminance,
    rangeWindow,
    radialWindow,
    PT_MONTE_CARLO_WGSL,
    PT_SKY_WGSL,
    buildSphericalRect,
    sampleSphericalRect,
    sphericalRectInversePdf,
    coneSolidAngle,
    sampleConeLocal,
    sampleCone,
    frameAround,
    outOfFrame,
    PT_LIGHT_STRUCT_WGSL,
    PT_T_MAX_WGSL,
  ],
  `const PT_LIGHT_SKY:u32=${PT_LIGHT.sky}u;
const PT_LIGHT_DIRECTIONAL:u32=${PT_LIGHT.directional}u;
const PT_LIGHT_POINT:u32=${PT_LIGHT.point}u;
const PT_LIGHT_SPOT:u32=${PT_LIGHT.spot}u;
const PT_LIGHT_RECT:u32=${PT_LIGHT.rect}u;
struct PtLightHit{radiance:vec3f,pdf:f32,hitT:f32,}
struct PtLightSample{radianceOverPdf:vec3f,pdf:f32,direction:vec3f,distance:f32,}
fn ptNoLightHit()->PtLightHit{return PtLightHit(vec3f(0.0),0.0,0.0);}
fn ptNoLightSample()->PtLightSample{return PtLightSample(vec3f(0.0),0.0,vec3f(0.0,0.0,1.0),0.0);}
fn ptLightKind(id:u32)->u32{return u32(directLights.lights[id].position.w);}
fn ptLightColour(id:u32)->vec3f{return directLights.lights[id].colour.xyz;}
fn ptLightCastsShadow(id:u32)->bool{return directLights.lights[id].shares.w>0.0;}
fn ptLightDiffuseScale(id:u32)->f32{return directLights.lights[id].shares.x;}
fn ptLightSpecularScale(id:u32)->f32{return directLights.lights[id].shares.y;}
fn ptLightIndirectScale(id:u32,pathRoughness:f32)->f32{return mix(1.0,directLights.lights[id].extra.x,saturate(4.0*pathRoughness));}
fn ptLightFalloff(light:PtLight,distanceSquared:f32)->f32{
 let range=light.colour.w;
 if(range<=0.0){return 1.0;}
 let distance=sqrt(distanceSquared);
 if(light.shares.z>0.0){return distanceSquared*radialWindow(distance,range,light.shares.z);}
 return rangeWindow(distance,range);
}
fn ptSpotCone(light:PtLight,toLight:vec3f)->f32{
 let ramp=saturate((dot(toLight,-light.axis.xyz)-light.size.z)*light.size.w);
 return ramp*ramp;
}
fn ptLampAttenuation(light:PtLight,toLight:vec3f,distanceSquared:f32,spot:bool)->f32{
 var a=ptLightFalloff(light,distanceSquared);
 if(spot){a*=ptSpotCone(light,toLight*inverseSqrt(distanceSquared));}
 return a;
}
fn ptTraceSun(light:PtLight,direction:vec3f,tMax:f32)->PtLightHit{
 if(tMax!=PT_T_MAX){return ptNoLightHit();}
 let sin2=light.tangent.w*light.tangent.w;
 let oneMinusCos=select(1.0-sqrt(1.0-sin2),sin2*(0.5+0.125*sin2),sin2<0.01);
 let cosTheta=saturate(dot(normalize(direction),light.axis.xyz));
 if(1.0-cosTheta<oneMinusCos){
  let solid=2.0*PI*oneMinusCos;
  return PtLightHit(light.colour.xyz/solid,1.0/solid,PT_T_MAX);
 }
 return ptNoLightHit();
}
fn ptTraceLamp(light:PtLight,origin:vec3f,direction:vec3f,tMin:f32,tMax:f32,spot:bool)->PtLightHit{
 let oc=origin-light.position.xyz;
 let distanceSquared=dot(oc,oc);
 let radius2=min(0.99*distanceSquared,light.tangent.w*light.tangent.w);
 let b=dot(oc,direction);
 let h=radius2-dot(oc-b*direction,oc-b*direction);
 if(h>0.0){
  let t=-b-sqrt(h);
  if(t>tMin&&t<tMax){
   let sin2=radius2/distanceSquared;
   let solid=coneSolidAngle(sin2);
   let attenuation=ptLampAttenuation(light,-oc,distanceSquared,spot);
   return PtLightHit(light.colour.xyz/(PI*radius2)*attenuation,1.0/solid,t);
  }
 }
 return ptNoLightHit();
}
fn ptRectBasis(light:PtLight)->mat3x3f{
 return mat3x3f(cross(light.axis.xyz,light.tangent.xyz),light.tangent.xyz,light.axis.xyz);
}
fn ptTraceRect(light:PtLight,origin:vec3f,direction:vec3f,tMin:f32,tMax:f32)->PtLightHit{
 let toLight=light.position.xyz-origin;
 let cosine=dot(direction,light.axis.xyz);
 let t=dot(toLight,light.axis.xyz)/cosine;
 if(cosine<0.0&&t>tMin&&t<tMax){
  let p=t*direction-toLight;
  let basis=ptRectBasis(light);
  let uv=vec2f(dot(p,basis[0]),dot(p,basis[1]));
  if(all(abs(uv)<=0.5*light.size.xy)){
   let rect=buildSphericalRect(toLight,basis[0],basis[1],-light.axis.xyz,0.5*light.size.xy);
   let radiance=light.colour.xyz*ptLightFalloff(light,dot(toLight,toLight));
   return PtLightHit(radiance,1.0/sphericalRectInversePdf(direction,t*t,rect),t);
  }
 }
 return ptNoLightHit();
}
fn ptTraceLight(origin:vec3f,direction:vec3f,tMin:f32,tMax:f32,id:u32)->PtLightHit{
 let light=directLights.lights[id];
 switch ptLightKind(id){
  case PT_LIGHT_SKY:{
   if(tMax!=PT_T_MAX){return ptNoLightHit();}
   let s=ptSkyEval(direction);
   return PtLightHit(s.xyz,s.w,PT_T_MAX);
  }
  case PT_LIGHT_DIRECTIONAL:{return ptTraceSun(light,direction,tMax);}
  case PT_LIGHT_POINT:{return ptTraceLamp(light,origin,direction,tMin,tMax,false);}
  case PT_LIGHT_SPOT:{return ptTraceLamp(light,origin,direction,tMin,tMax,true);}
  case PT_LIGHT_RECT:{return ptTraceRect(light,origin,direction,tMin,tMax);}
  default:{return ptNoLightHit();}
 }
}
fn ptSampleLamp(light:PtLight,e:vec2f,point:vec3f,spot:bool)->PtLightSample{
 let toLight=light.position.xyz-point;
 let distanceSquared=dot(toLight,toLight);
 let radius2=min(0.99*distanceSquared,light.tangent.w*light.tangent.w);
 let sin2=radius2/distanceSquared;
 let sampled=sampleConeLocal(e,sin2,false);
 let cosTheta=sampled.z;
 let sinTheta2=1.0-cosTheta*cosTheta;
 var out:PtLightSample;
 out.direction=outOfFrame(sampled.xyz,frameAround(normalize(toLight)));
 out.distance=length(toLight)*(cosTheta-sqrt(max(sin2-sinTheta2,0.0)));
 // A lamp of no radius is a point no direction the material chooses can meet: its density is one.
 out.pdf=select(sampled.w,1.0,radius2<=0.0);
 let power=light.colour.xyz;
 out.radianceOverPdf=select(power/(PI*radius2)/out.pdf,power/distanceSquared,sin2<0.001);
 out.radianceOverPdf*=ptLampAttenuation(light,toLight,distanceSquared,spot);
 return out;
}
fn ptSampleRect(light:PtLight,e:vec2f,point:vec3f)->PtLightSample{
 let basis=ptRectBasis(light);
 let toCentre=light.position.xyz-point;
 if(dot(-light.axis.xyz,toCentre)<=0.0){return ptNoLightSample();}
 let rect=buildSphericalRect(toCentre,basis[0],basis[1],-light.axis.xyz,0.5*light.size.xy);
 let radiance=light.colour.xyz*ptLightFalloff(light,dot(toCentre,toCentre));
 let sampled=sampleSphericalRect(e,rect);
 return PtLightSample(radiance*sampled.invPdf,1.0/sampled.invPdf,sampled.direction,sampled.distance);
}
fn ptSampleLight(id:u32,e:vec2f,point:vec3f,normal:vec3f)->PtLightSample{
 let light=directLights.lights[id];
 switch ptLightKind(id){
  case PT_LIGHT_SKY:{
   let s=ptSkySample(e);
   if(!(s.pdf>0.0)){return ptNoLightSample();}
   return PtLightSample(s.radiance/s.pdf,s.pdf,s.direction,PT_T_MAX);
  }
  case PT_LIGHT_DIRECTIONAL:{
   let sampled=sampleCone(e,light.tangent.w*light.tangent.w,light.axis.xyz,false);
   return PtLightSample(light.colour.xyz,sampled.w,sampled.xyz,PT_T_MAX);
  }
  case PT_LIGHT_POINT:{return ptSampleLamp(light,e,point,false);}
  case PT_LIGHT_SPOT:{return ptSampleLamp(light,e,point,true);}
  case PT_LIGHT_RECT:{return ptSampleRect(light,e,point);}
  default:{return ptNoLightSample();}
 }
}
fn ptEstimateLight(id:u32,point:vec3f,normal:vec3f)->f32{
 let light=directLights.lights[id];
 let power=luminance(light.colour.xyz);
 switch ptLightKind(id){
  case PT_LIGHT_SKY:{return ptSkyEstimate();}
  case PT_LIGHT_DIRECTIONAL:{return power;}
  case PT_LIGHT_POINT,PT_LIGHT_SPOT:{
   let toLight=light.position.xyz-point;
   let distanceSquared=dot(toLight,toLight);
   return power*ptLampAttenuation(light,toLight,distanceSquared,ptLightKind(id)==PT_LIGHT_SPOT)/distanceSquared;
  }
  case PT_LIGHT_RECT:{
   let toLight=light.position.xyz-point;
   let distanceSquared=dot(toLight,toLight);
   let behind=saturate(-dot(normalize(toLight),light.axis.xyz));
   if(behind<=0.0){return 0.0;}
   let size=light.size.xy;
   return power*ptLightFalloff(light,distanceSquared)*size.x*size.y*behind/distanceSquared;
  }
  default:{return 0.0;}
 }
}`,
)
