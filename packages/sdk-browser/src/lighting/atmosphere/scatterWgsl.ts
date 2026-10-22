import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { ATMOSPHERE_SLOT } from '../../../../sdk-core/src/scene/core/atmospherePack.ts'
import { OPTICS_WGSL } from './opticsWgsl.ts'

/**
 * THE MARCH: the light the sun scatters into a ray through the air, and what the ray keeps of what
 * lies behind it.
 *
 * The ray is cut into steps. At each, the air's extinction takes a share of what comes from
 * farther (`transmittance`), and adds what it scatters toward the eye: the sun's light, through
 * the air between the step and the sun (the transmittance table), times the share of it the
 * phase sends along the ray, in shadow where the planet hides the sun, plus the light already
 * scattered more than once (the multi-scattering table). The step's sum is integrated in closed
 * form against the extinction, so a thick step does not overshoot. A ray that ends on the
 * ground adds the light the ground bounces: its albedo over π times what reaches it.
 *
 * Steps are `samples` even ones, or, `variable`, as many as the length asks between
 * `minSamples` and `maxSamples`, thicker the farther they lie so that the near air, where the
 * eye resolves most, is sampled most finely.
 *
 * `multiAs1` is what the air would scatter of a unit radiance filling the sphere: the table of
 * multiple scattering is built from it (`multiScatterWgsl`).
 */
export const SCATTER_WGSL = wgslBlock(
  'SCATTER_WGSL',
  [OPTICS_WGSL],
  `
struct Scatter{radiance:vec3f,transmittance:vec3f,multiAs1:vec3f,}
struct Marching{variable:bool,samples:f32,minSamples:f32,maxSamples:f32,distanceInv:f32,}
/** Where in a step its sample lies: a little before its middle, as the integration of the table's
 *  rays has always sampled. */
const SAMPLE_OFFSET:f32=0.3;
fn integrateAir(start:vec3f,dir:vec3f,ground:bool,march:Marching,miePhase:bool,toSun:vec3f,illuminance:vec3f,distanceScale:f32,reach:f32)->Scatter{
 var r:Scatter;
 r.radiance=vec3f(0.0);
 r.transmittance=vec3f(1.0);
 r.multiAs1=vec3f(0.0);
 let bottom=bottomRadius();let top=topRadius();
 if(dot(start,start)<=bottom*bottom){return r;}
 var tBottom=0.0;var tMax=0.0;
 let solBottom=raySphere(start,dir,bottom);
 let solTop=raySphere(start,dir,top);
 let noBottom=solBottom.x<0.0&&solBottom.y<0.0;
 let noTop=solTop.x<0.0&&solTop.y<0.0;
 if(noTop){return r;}
 if(noBottom){tMax=max(solTop.x,solTop.y);}
 else{tBottom=max(0.0,min(solBottom.x,solBottom.y));tMax=tBottom;}
 tMax=min(tMax,reach);
 var sampleCount=march.samples;
 var sampleFloor=march.samples;
 var tMaxFloor=tMax;
 if(march.variable){
  sampleCount=mix(march.minSamples,march.maxSamples,saturate(tMax*march.distanceInv));
  sampleFloor=floor(sampleCount);
  tMaxFloor=tMax*sampleFloor/sampleCount;
 }
 var dt=tMax/sampleCount;
 let uniformPhase=1.0/(4.0*PI);
 let cosTheta=dot(toSun,dir);
 let miePhaseValue=hgPhase(atmo(${ATMOSPHERE_SLOT.mieExtinction}u).w,-cosTheta);
 let rayPhaseValue=rayleighPhase(cosTheta);
 var radiance=vec3f(0.0);
 var throughput=vec3f(1.0);
 for(var i:f32=0.0;i<sampleCount;i+=1.0){
  var t:f32;
  if(march.variable){
   var t0=i/sampleFloor;var t1=(i+1.0)/sampleFloor;
   t0=t0*t0;t1=t1*t1;
   t0=tMaxFloor*t0;
   t1=select(tMaxFloor*t1,tMax,t1>1.0);
   t=t0+(t1-t0)*SAMPLE_OFFSET;
   dt=t1-t0;
  }else{
   t=tMax*(i+SAMPLE_OFFSET)/sampleCount;
  }
  let p=start+t*dir;
  let up=p/length(p);
  let m=mediumAt(p);
  let stepT=exp(-m.extinction*dt*distanceScale);
  let sunCos=dot(toSun,up);
  let toSunT=transmittanceToward(p,toSun);
  let phased=select(m.scattering*uniformPhase,m.mieScattering*miePhaseValue+m.rayScattering*rayPhaseValue,miePhase);
  let shadow=select(1.0,0.0,raySphereNearest(p,toSun,up*PLANET_OFFSET,bottom)>=0.0);
  let scattered=illuminance*(shadow*toSunT*phased+multiScatter(p,sunCos)*m.scattering);
  let safe=max(m.extinction,vec3f(1e-9));
  r.multiAs1+=throughput*m.scattering*dt;
  radiance+=throughput*((scattered-scattered*stepT)/safe);
  throughput*=stepT;
 }
 if(ground&&tMax==tBottom){
  let p=start+tBottom*dir;
  let up=p/length(p);
  radiance+=illuminance*transmittanceToward(p,toSun)*throughput*saturate(dot(up,toSun))*atmo(${ATMOSPHERE_SLOT.ground}u).xyz/PI;
 }
 r.radiance=radiance;
 r.transmittance=throughput;
 return r;
}
`,
)
