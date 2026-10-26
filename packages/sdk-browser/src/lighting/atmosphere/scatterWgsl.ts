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
 * scattered more than once (the multi-scattering table; for the first light, what the clouds' sky
 * occlusion leaves of it, `airSkyOcclusion`). The air's second light, where there is
 * one (`Suns.count` 2), adds the same sum of its own to the step's, with its own direction, phase,
 * shadow and multiple scattering, and a ground that ends the ray bounces it too. The step's sum is
 * integrated in closed form against the extinction, so a thick step does not overshoot. A ray that
 * ends on the ground adds the light the ground bounces: its albedo over π times what reaches it.
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
struct Scatter{radiance:vec3f,transmittance:vec3f,multiAs1:vec3f,radianceMie:vec3f,radianceRay:vec3f,transmittanceMie:vec3f,transmittanceRay:vec3f,}
/** How a ray is stepped: \`samples\` even steps, or, \`variable\`, as many as its length asks between
 *  \`minSamples\` and \`maxSamples\` over \`1/distanceInv\` kilometres; \`offset\` where in a step
 *  its sample lies; \`separate\` whether the haze's light and the air's are kept apart too. */
struct Marching{variable:bool,samples:f32,minSamples:f32,maxSamples:f32,distanceInv:f32,offset:f32,separate:bool,}
/** Where in a step its sample lies by default: a little before its middle, as the integration of the
 *  table's rays has always sampled. */
const SAMPLE_OFFSET:f32=0.3;
const UNIFORM_PHASE:f32=1.0/(4.0*PI);
fn newMarch()->Marching{
 var march:Marching;
 march.offset=SAMPLE_OFFSET;
 return march;
}
/** The march of the sky table's own samples, thicker with the distance over \`SKY_VIEW_DISTANCE_KM\`: the one the table's
 *  builder and the sky a capture draws share. */
fn skyViewMarch()->Marching{
 var march=newMarch();
 march.variable=true;
 march.minSamples=SKY_VIEW_SAMPLES_MIN;
 march.maxSamples=samplesMaxOf(SKY_VIEW_SAMPLES_MAX,SKY_VIEW_SAMPLES_MIN);
 march.distanceInv=1.0/SKY_VIEW_DISTANCE_KM;
 return march;
}
/** The march of a sky pixel's samples (\`MARCH_DISTANCE_KM\`), their offset in a step \`noise\`: the one the marched
 *  sky and the haze on a cloud share. */
fn airMarch(noise:f32)->Marching{
 var march=newMarch();
 march.variable=true;
 march.minSamples=MARCH_SAMPLES_MIN;
 march.maxSamples=samplesMaxOf(MARCH_SAMPLES_MAX,MARCH_SAMPLES_MIN);
 march.distanceInv=1.0/MARCH_DISTANCE_KM;
 march.offset=noise;
 return march;
}
/** The reach of a march that goes as far as the air lets it, kilometres. */
const AIR_REACH_KM:f32=9000000.0;
/** What a light gives the phase along a ray that makes \`cosTheta\` with it: the haze's share, then
 *  the air's. */
fn phasesOf(cosTheta:f32)->vec2f{return vec2f(hgPhase(atmo(${ATMOSPHERE_SLOT.mieExtinction}u).w,-cosTheta),rayleighPhase(cosTheta));}
/** What a light scatters into the ray at \`p\`: the whole of the medium \`m\`, the haze's share of it and the air's. */
struct SunParts{all:vec3f,mie:vec3f,ray:vec3f,}
/** What a light scatters into the ray at \`p\` (\`up\` there), in the medium \`m\`: its illuminance times
 *  the air between it and \`p\` (none in the planet's shadow, and \`volumeShadow\` of what the
 *  scene's shadows leave) times the phase \`phase\`, plus the light scattered more than once, of
 *  which \`multiShade\` is what the clouds' sky occlusion leaves. The air between the light and \`p\` and the
 *  multiple scattering are read once for the three sums (the whole medium, the haze alone, the air alone).
 *  \`bottom\` is the planet's radius. */
fn sunScatter(p:vec3f,up:vec3f,m:Medium,sun:Sun,phase:vec2f,miePhase:bool,bottom:f32,volumeShadow:f32,multiShade:f32)->SunParts{
 let phasedMie=m.mieScattering*select(UNIFORM_PHASE,phase.x,miePhase);
 let phasedRay=m.rayScattering*select(UNIFORM_PHASE,phase.y,miePhase);
 let shadow=select(1.0,0.0,raySphereNearest(p,sun.toward,up*PLANET_OFFSET,bottom)>=0.0)*volumeShadow;
 let direct=sun.illuminance*shadow*transmittanceToward(p,sun.toward);
 let multi=sun.illuminance*multiScatter(p,dot(sun.toward,up))*multiShade;
 return SunParts(direct*(phasedMie+phasedRay)+multi*m.scattering,direct*phasedMie+multi*m.mieScattering,direct*phasedRay+multi*m.rayScattering);
}
/** What a light gives a ray that ends on the ground at \`p\` (\`up\` there): its illuminance through
 *  the air toward it, by the cosine at the ground, times what the ray kept and the albedo over pi. */
fn groundBounce(p:vec3f,up:vec3f,sun:Sun,throughput:vec3f)->vec3f{
 return sun.illuminance*transmittanceToward(p,sun.toward)*throughput*saturate(dot(up,sun.toward))*atmo(${ATMOSPHERE_SLOT.ground}u).xyz/PI;
}
/** The light of every light of the air at the step \`p\`, of the medium \`m\` (\`sunScatter\`: all of it, the haze's, the air's),
 *  \`shade\` the share of each light the scene's shadows leave (\`x\`, \`y\`) and the
 *  share of the first light's multiple scattering the clouds' sky occlusion leaves (\`z\`): the
 *  second light's is not dimmed by it. */
fn stepScatter(p:vec3f,up:vec3f,m:Medium,suns:Suns,phases:array<vec2f,2>,shade:vec3f,miePhase:bool,bottom:f32)->SunParts{
 var scattered=SunParts(vec3f(0.0),vec3f(0.0),vec3f(0.0));
 for(var k=0u;k<suns.count;k++){
  let one=sunScatter(p,up,m,suns.list[k],phases[k],miePhase,bottom,shade[k],select(1.0,shade.z,k==0u));
  scattered=SunParts(scattered.all+one.all,scattered.mie+one.mie,scattered.ray+one.ray);
 }
 return scattered;
}
/** The ray's reach: from \`start\` along \`dir\` to the air's top or the ground, whichever it meets
 *  first, as a distance and whether it ends on the ground (\`w\`); \`x\` negative for a ray that never
 *  crosses the air. */
fn rayReach(start:vec3f,dir:vec3f,bottom:f32,top:f32)->vec3f{
 let solBottom=raySphere(start,dir,bottom);
 let solTop=raySphere(start,dir,top);
 let noBottom=solBottom.x<0.0&&solBottom.y<0.0;
 let noTop=solTop.x<0.0&&solTop.y<0.0;
 if(noTop){return vec3f(-1.0,0.0,0.0);}
 if(noBottom){return vec3f(max(solTop.x,solTop.y),0.0,0.0);}
 let hit=max(0.0,min(solBottom.x,solBottom.y));
 return vec3f(hit,hit,1.0);
}
fn integrateAir(start:vec3f,dir:vec3f,ground:bool,march:Marching,miePhase:bool,suns:Suns,distanceScale:f32,reach:f32)->Scatter{
 var r:Scatter;
 r.radiance=vec3f(0.0);
 r.transmittance=vec3f(1.0);
 r.multiAs1=vec3f(0.0);
 r.radianceMie=vec3f(0.0);
 r.radianceRay=vec3f(0.0);
 r.transmittanceMie=vec3f(1.0);
 r.transmittanceRay=vec3f(1.0);
 let bottom=bottomRadius();let top=topRadius();
 if(dot(start,start)<=bottom*bottom){return r;}
 let span=rayReach(start,dir,bottom,top);
 if(span.x<0.0){return r;}
 let tBottom=span.y;
 let tMax=min(span.x,reach);
 var sampleCount=march.samples;
 var sampleFloor=march.samples;
 var tMaxFloor=tMax;
 if(march.variable){
  sampleCount=mix(march.minSamples,march.maxSamples,saturate(tMax*march.distanceInv));
  sampleFloor=floor(sampleCount);
  tMaxFloor=tMax*sampleFloor/sampleCount;
 }
 var dt=tMax/sampleCount;
 var phases:array<vec2f,2>;
 for(var k=0u;k<suns.count;k++){phases[k]=phasesOf(dot(suns.list[k].toward,dir));}
 var radiance=vec3f(0.0);
 var throughput=vec3f(1.0);
 for(var i:f32=0.0;i<sampleCount;i+=1.0){
  var t:f32;
  if(march.variable){
   var t0=i/sampleFloor;var t1=(i+1.0)/sampleFloor;
   t0=t0*t0;t1=t1*t1;
   t0=tMaxFloor*t0;
   t1=select(tMaxFloor*t1,tMax,t1>1.0);
   t=t0+(t1-t0)*march.offset;
   dt=t1-t0;
  }else{
   t=tMax*(i+march.offset)/sampleCount;
  }
  let p=start+t*dir;
  let up=p/length(p);
  let m=mediumAt(p);
  let stepT=exp(-m.extinction*dt*distanceScale);
  var shade=vec3f(1.0);
  for(var k=0u;k<suns.count;k++){shade[k]=airShadow(k,p)*airCloudShadow(k,p);}
  shade.z=airSkyOcclusion(p);
  let lit=stepScatter(p,up,m,suns,phases,shade,miePhase,bottom);
  let safe=max(m.extinction,vec3f(1e-9));
  r.multiAs1+=throughput*m.scattering*dt;
  radiance+=throughput*((lit.all-lit.all*stepT)/safe);
  if(march.separate){
   // The haze's light and the air's, each with the ozone's absorption shared half and half.
   let mieT=exp(-(m.mieExtinction+m.ozoneExtinction)*dt*distanceScale);
   let rayT=exp(-(m.rayScattering+m.ozoneExtinction)*dt*distanceScale);
   r.radianceMie+=throughput*((lit.mie-lit.mie*stepT)/safe);
   r.radianceRay+=throughput*((lit.ray-lit.ray*stepT)/safe);
   r.transmittanceMie*=mieT;
   r.transmittanceRay*=rayT;
  }
  throughput*=stepT;
 }
 if(ground&&tMax==tBottom){
  let p=start+tBottom*dir;
  let up=p/length(p);
  for(var k=0u;k<suns.count;k++){radiance+=groundBounce(p,up,suns.list[k],throughput);}
 }
 r.radiance=radiance;
 r.transmittance=throughput;
 return r;
}
`,
)
