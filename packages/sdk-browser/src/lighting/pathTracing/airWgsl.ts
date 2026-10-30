import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { PI } from '../../../../math/src/wgsl/constants.ts'
import { hgPhase } from '../../../../math/src/wgsl/lighting.ts'
import { frameAround, outOfFrame } from '../../../../math/src/wgsl/basis.ts'
import { luminance } from '../../../../math/src/wgsl/color.ts'
import { ATMOSPHERE_SLOT } from '../../../../sdk-core/src/scene/core/atmospherePack.ts'
import { PT_AIR_FLAG, PT_AIR_MEDIUM_WGSL } from './airMediumWgsl.ts'
import { PT_T_MAX_WGSL } from './lightsWgsl.ts'
import { PT_STATE_WGSL } from './pathWgsl.ts'
import { PT_SURFACE_WGSL } from './surfaceWgsl.ts'
import { PT_VIEW_WGSL } from './viewWgsl.ts'
import { PT_RIS_WGSL } from './risWgsl.ts'

const S = ATMOSPHERE_SLOT

/** The class key of the planet's ground as a surface a path meets: no class shades it, the finish gives it the ground's albedo. */
export const PT_GROUND_CLASS = 0xfffffe

/**
 * THE AIR AS A VOLUME THE PATHS TRAVEL IN (`ptAtmo`, `ptAirDepth`, `ptView`, the path's reservoir): a ray's place in the planet's frame (`ptAirRayOf`), where it crosses the air and the planet (`ptAirSpan`, metres,
 * the ground's distance negative where there is none), the most the air holds along a stretch of it (`ptAirBound`, the majorant of the tracking, per metre), the transmittance read from the optical depth table
 * (`ptAirTransmittance`, the table read by loads, bilinearly, as 32-bit floats may not be filtered) or estimated by null tracking (`ptAirNullTrack`), and the visibility of a ray toward a light through the air
 * (`ptAirVisible`: the planet blocks it).
 *
 * `ptAirTrack` walks a ray through the air up to the surface (or the planet) it meets, taking distances in proportion to the transmittance by the colour channel the path's throughput weighs
 * (spectral tracking); at each real collision the camera's alpha grows and, if the bounce is not the last, the collision stands for the scattering event of the bounce with the
 * probability its contribution gives among the others and the surface (`ptPathRisAccept`, a reservoir the path keeps from the start of the bounce); the throughput leaves the walk as the transmittance
 * (the table's where the analytic transmittance is on) or the product of the walk.
 */
export const PT_AIR_WGSL = wgslBlock(
  'PT_AIR_WGSL',
  [PT_AIR_MEDIUM_WGSL, PT_T_MAX_WGSL, PT_VIEW_WGSL, PT_STATE_WGSL, PT_RIS_WGSL, luminance],
  `fn ptAirOn()->bool{return (ptAtmo.options.x&${PT_AIR_FLAG.enabled}u)!=0u;}
fn ptAirAnalytic()->bool{return (ptAtmo.options.x&${PT_AIR_FLAG.analytic}u)!=0u;}
fn ptAirVolumeLights()->bool{return (ptAtmo.options.x&${PT_AIR_FLAG.volumeLights}u)!=0u;}
struct PtAirRay{h:f32,c:f32,q:vec3f,}
fn ptAirRayOf(origin:vec3f,direction:vec3f)->PtAirRay{
 let place=ptAtmo.block[${S.planetPlace}];
 let planet=ptAtmo.block[${S.planet}];
 let scene=origin+ptView.eye.xyz;
 let q=vec3f((scene.x-place.x)*0.001,(scene.y-planet.w)*0.001,(scene.z-place.y)*0.001);
 let h=planet.y+ptAirAltitude(q);
 return PtAirRay(h,(planet.y*direction.y+dot(q,direction))/h,q);
}
fn ptAirChord(r:PtAirRay,radius:f32)->vec2f{
 let d=radius*radius-r.h*r.h*(1.0-r.c*r.c);
 if(d<0.0){return vec2f(-1.0);}
 let s=sqrt(d);
 return vec2f(-r.h*r.c-s,-r.h*r.c+s);
}
struct PtAirSpan{near:f32,far:f32,ground:f32,}
fn ptAirSpan(r:PtAirRay)->PtAirSpan{
 let top=ptAirChord(r,ptAirTop());
 let bottom=ptAirChord(r,ptAirBottom());
 var s:PtAirSpan;
 s.near=max(top.x*1000.0,0.0);
 s.far=select(-1.0,top.y*1000.0,top.y>0.0);
 s.ground=select(-1.0,bottom.x*1000.0,bottom.x>0.0);
 return s;
}
fn ptAirBound(r:PtAirRay,tMin:f32,tMax:f32)->vec3f{
 let a=ptAirAt(r.h,r.c,tMin*0.001).x;
 let b=ptAirAt(r.h,r.c,tMax*0.001).x;
 var lo=min(a,b);
 let hi=max(a,b);
 let closest=-r.h*r.c*1000.0;
 if(closest>tMin&&closest<tMax){lo=min(lo,r.h*sqrt(saturate(1.0-r.c*r.c)));}
 let low=max(0.0,lo-ptAirBottom());
 let high=max(0.0,hi-ptAirBottom());
 let lines=ptAtmo.block[${S.ozoneLines}];
 let peak=ptAtmo.block[${S.ozone}].w;
 let ends=vec2f(select(saturate(lines.z*low+lines.w),saturate(lines.x*low+lines.y),low<peak),select(saturate(lines.z*high+lines.w),saturate(lines.x*high+lines.y),high<peak));
 var ozone=max(ends.x,ends.y);
 if(low<peak&&peak<high){ozone=lines.x*peak+lines.y;}
 let mie=exp(ptAtmo.block[${S.mieScattering}].w*low);
 let ray=exp(ptAtmo.block[${S.rayleigh}].w*low);
 return (mie*ptAtmo.block[${S.mieExtinction}].xyz+ray*ptAtmo.block[${S.rayleigh}].xyz+ozone*ptAtmo.block[${S.ozone}].xyz)*0.001;
}
fn ptAirDepthRead(uv:vec2f)->vec3f{
 let size=vec2f(textureDimensions(ptAirDepth));
 let at=clamp(uv,vec2f(0.0),vec2f(1.0))*size-vec2f(0.5);
 let base=floor(at);
 let f=at-base;
 let b=vec2i(base);
 let top=vec2i(size)-vec2i(1);
 let p00=textureLoad(ptAirDepth,clamp(b,vec2i(0),top),0).xyz;
 let p10=textureLoad(ptAirDepth,clamp(b+vec2i(1,0),vec2i(0),top),0).xyz;
 let p01=textureLoad(ptAirDepth,clamp(b+vec2i(0,1),vec2i(0),top),0).xyz;
 let p11=textureLoad(ptAirDepth,clamp(b+vec2i(1,1),vec2i(0),top),0).xyz;
 return mix(mix(p00,p10,f.x),mix(p01,p11,f.x),f.y);
}
fn ptAirOptical(hIn:f32,cIn:f32)->vec3f{
 var tau=vec3f(0.0);
 var hc=vec2f(hIn,cIn);
 let bottom=ptAirBottom();
 if(hIn<bottom){
  let reach=-cIn*hIn+sqrt(max(bottom*bottom+hIn*hIn*(cIn*cIn-1.0),0.0));
  tau=reach*ptAirMediumAt(0.0).extinction;
  hc=ptAirAt(hIn,cIn,reach);
 }
 return tau+ptAirDepthRead(ptAirLutUv(hc.x,hc.y));
}
fn ptAirTransmittance(r:PtAirRay,tMin:f32,tMax:f32)->vec3f{
 let a=ptAirAt(r.h,r.c,tMin*0.001);
 let b=ptAirAt(r.h,r.c,tMax*0.001);
 return exp(-max(ptAirOptical(a.x,a.y)-ptAirOptical(b.x,b.y),vec3f(0.0)));
}
fn ptAirSampleDistance(e:f32,sigma:vec3f,pdf:vec3f)->f32{
 let cdf=vec3f(pdf.x,pdf.x+pdf.y,pdf.x+pdf.y+pdf.z);
 if(cdf.z>0.0){
  let q=e*cdf.z;
  let one=0.99999994;
  if(q<cdf.x){return -log(1.0-min(q/cdf.x,one))/sigma.x;}
  if(q<cdf.y){return -log(1.0-min((q-cdf.x)/(cdf.y-cdf.x),one))/sigma.y;}
  return -log(1.0-min((q-cdf.y)/(cdf.z-cdf.y),one))/sigma.z;
 }
 return -1.0;
}
fn ptAirHit(t:f32,sigma:vec3f,pdf:vec3f)->vec3f{
 let p=pdf/(pdf.x+pdf.y+pdf.z);
 let tr=exp(-t*sigma);
 let mis=dot(p,sigma*tr);
 return select(vec3f(0.0),tr/mis,mis>0.0);
}
fn ptAirMiss(t:f32,sigma:vec3f,pdf:vec3f)->vec3f{
 let p=pdf/(pdf.x+pdf.y+pdf.z);
 let tr=exp(-t*sigma);
 let mis=dot(p,tr);
 return select(vec3f(0.0),tr/mis,mis>0.0);
}
fn ptAirLowClamp(t:vec3f)->f32{return saturate(1000.0*max(t.x,max(t.y,t.z))-1.0);}
fn ptAirDensityAt(r:PtAirRay,direction:vec3f,t:f32)->PtAirMedium{return ptAirMediumAt(ptAirAltitude(r.q+direction*(t*0.001)));}
fn ptAirNullTrack(path:ptr<function,PtPath>,r:PtAirRay,direction:vec3f,near:f32,far:f32)->vec3f{
 var thr=vec3f(1.0);
 var t=near;
 for(var iter=0u;iter<ptAtmo.options.y;iter++){
  let bar=ptAirBound(r,t,far);
  let dist=ptAirSampleDistance(ptRand1(&(*path).rand),bar,thr);
  if(dist<0.0){break;}
  if(t+dist<far){
   t+=dist;
   thr*=ptAirHit(dist,bar,thr);
   let sigmaT=min(ptAirDensityAt(r,direction,t).extinction*0.001,bar);
   thr*=bar-sigmaT;
   thr*=ptAirLowClamp(thr);
   if(!any(thr>vec3f(0.0))){break;}
  }else{
   thr*=ptAirMiss(far-t,bar,thr);
   break;
  }
 }
 return thr;
}
fn ptAirVisible(path:ptr<function,PtPath>,origin:vec3f,direction:vec3f,tMax:f32,casts:bool)->vec3f{
 if(!ptAirOn()||!casts){return vec3f(1.0);}
 let r=ptAirRayOf(origin,direction);
 let span=ptAirSpan(r);
 if(span.ground>0.0&&span.ground<tMax){return vec3f(0.0);}
 let far=min(span.far,tMax);
 if(!(span.near<far)){return vec3f(1.0);}
 if(ptAirAnalytic()){return ptAirTransmittance(r,span.near,far);}
 return ptAirNullTrack(path,r,direction,span.near,far);
}
fn ptPathRisAccept(path:ptr<function,PtPath>,w:f32)->bool{
 var ris=PtRis((*path).risSum,(*path).ris);
 let keep=ptRisAccept(&ris,w);
 (*path).risSum=ris.sum;
 (*path).ris=ris.rand;
 return keep;
}
fn ptAirTrack(path:ptr<function,PtPath>,r:PtAirRay,origin:vec3f,direction:vec3f,near:f32,far:f32,camera:bool,last:bool){
 if(!(near<far)){return;}
 let analytic=ptAirAnalytic();
 if(analytic&&last){
  (*path).throughput*=ptAirTransmittance(r,near,far);
  return;
 }
 var t=near;
 var thr=(*path).throughput;
 for(var iter=0u;iter<ptAtmo.options.y;iter++){
  var bar=ptAirBound(r,t,far);
  if(!analytic&&camera){bar*=2.0;}
  let dist=ptAirSampleDistance(ptRand1(&(*path).rand),bar,thr);
  if(dist<0.0){break;}
  if(t+dist<far){
   t+=dist;
   thr*=ptAirHit(dist,bar,thr);
   let m=ptAirDensityAt(r,direction,t);
   let sigmaT=min(m.extinction*0.001,bar);
   if(camera){(*path).alpha+=luminance(thr*sigmaT);}
   if(!last){
    let sigmaS=min((m.rayleigh+m.mie)*0.001,sigmaT);
    let weight=1.0-saturate(((*path).roughness-0.10)/(0.15-0.10));
    (*path).albedo+=sigmaS*thr*weight;
    let contribution=thr*sigmaS;
    let w=max(contribution.x,max(contribution.y,contribution.z));
    if(ptPathRisAccept(path,w)){
     (*path).eventPosition=origin+direction*t;
     (*path).eventThroughput=contribution/w;
    }
   }
   thr*=bar-sigmaT;
   thr*=ptAirLowClamp(thr);
   if(!any(thr>vec3f(0.0))){break;}
  }else{
   thr*=ptAirMiss(far-t,bar,thr);
   break;
  }
 }
 if(analytic){(*path).throughput*=ptAirTransmittance(r,near,far);}else{(*path).throughput=thr;}
}`,
)

/** The phase functions of the air and the clouds: the Rayleigh lobe and its inversion, and the inversion of a Henyey-Greenstein lobe (the cosine of a forward direction is the view's negative). */
export const PT_AIR_LOBES_WGSL = wgslBlock(
  'PT_AIR_LOBES_WGSL',
  [PI],
  `fn ptAirRayleighPhase(c:f32)->f32{return 3.0/(16.0*PI)*(1.0+c*c);}
fn ptAirRayleighInvert(e:f32)->f32{
 let z=e*4.0-2.0;
 let u=pow(z+sqrt(z*z+1.0),1.0/3.0);
 return u-1.0/u;
}
fn ptAirHgInvert(e:f32,g:f32)->f32{
 let t0=(1.0-g)+g*e;
 let t1=(1.0-e)+e*e;
 let t2=t1+(g*e)*t0;
 let t3=(2.0*e-1.0)-g*g;
 let den=t0+g*e;
 return (t3+2.0*g*t2)/(den*den);
}`,
)

/**
 * THE SCATTERING OF THE AIR AT A POINT (`PtAirPhase`: the share of the Rayleigh scattering and of the haze's in each channel, and the haze's anisotropy), as a surface the next bounce is made from. The
 * phase is the two lobes' sum, the lobe of a sample chosen by the share of its channels (`ptAirLobeChance`); the Rayleigh lobe is sampled by inverting its distribution, the haze's Henyey-Greenstein lobe likewise.
 * The haze's lobe is sampled about the direction the ray goes in and measured against the view as the lights' evaluation does (the cosine of a forward direction is the view's negative), so that the weight of
 * a sample and its density agree with the evaluation toward a light.
 */
export const PT_AIR_PHASE_WGSL = wgslBlock(
  'PT_AIR_PHASE_WGSL',
  [PT_AIR_WGSL, PT_AIR_LOBES_WGSL, PT_SURFACE_WGSL, PI, hgPhase, frameAround, outOfFrame],
  `struct PtAirPhase{rayleigh:vec3f,mie:vec3f,g:f32,}
fn ptAirPhaseAt(position:vec3f)->PtAirPhase{
 let m=ptAirMediumAt(ptAirAltitude(ptAirRayOf(position,vec3f(0.0,1.0,0.0)).q));
 let s=m.rayleigh+m.mie;
 var p:PtAirPhase;
 p.rayleigh=select(vec3f(0.0),m.rayleigh/s,s>vec3f(0.0));
 p.mie=select(vec3f(0.0),m.mie/s,s>vec3f(0.0));
 p.g=ptAtmo.block[${S.mieExtinction}].w;
 return p;
}
fn ptAirLobeChance(p:PtAirPhase)->f32{return ptMisBalance(p.rayleigh.x+p.rayleigh.y+p.rayleigh.z,p.mie.x+p.mie.y+p.mie.z);}
fn ptAirPhaseLobes(p:PtAirPhase,cosView:f32,chance:f32)->PtLobes{
 var lobes=PtLobes(vec3f(0.0),0.0);
 lobes=ptAddLobe(lobes,p.rayleigh,ptAirRayleighPhase(cosView),chance);
 return ptAddLobe(lobes,p.mie,hgPhase(p.g,cosView),1.0-chance);
}
fn ptAirSamplePhase(p:PtAirPhase,view:vec3f,e:vec3f)->PtSample{
 let chance=ptAirLobeChance(p);
 var forward=0.0;
 if(e.x<chance){forward=ptAirRayleighInvert(ptRescale(e.x,0.0,chance));}
 else{forward=ptAirHgInvert(ptRescale(e.x,chance,1.0),p.g);}
 let sinTheta=sqrt(saturate(1.0-forward*forward));
 let phi=e.y*2.0*PI;
 let lobes=ptAirPhaseLobes(p,-forward,chance);
 var s:PtSample;
 s.direction=outOfFrame(vec3f(cos(phi)*sinTheta,sin(phi)*sinTheta,forward),frameAround(-view));
 s.weight=lobes.weight;
 s.pdf=lobes.pdf;
 s.positionBias=1.0;
 s.roughness=1.0;
 s.scatter=PT_SCATTER_VOLUME;
 return s;
}
fn ptAirEvalPhase(p:PtAirPhase,view:vec3f,l:vec3f)->PtEval{
 let lobes=ptAirPhaseLobes(p,dot(view,l),ptAirLobeChance(p));
 return PtEval(lobes.weight,lobes.pdf);
}`,
)
