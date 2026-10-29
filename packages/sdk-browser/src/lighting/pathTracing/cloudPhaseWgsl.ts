import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { PI } from '../../../../math/src/wgsl/constants.ts'
import { hgPhase } from '../../../../math/src/wgsl/lighting.ts'
import { frameAround, outOfFrame } from '../../../../math/src/wgsl/basis.ts'
import { ATMOSPHERE_SLOT } from '../../../../sdk-core/src/scene/core/atmospherePack.ts'
import { PT_AIR_LOBES_WGSL, PT_AIR_WGSL } from './airWgsl.ts'
import { PT_CLOUD_INTERSECT_WGSL } from './cloudWgsl.ts'
import { PT_SURFACE_WGSL } from './surfaceWgsl.ts'

/**
 * THE SCATTERING OF THE AIR AND THE CLOUDS AT A POINT (`PtAirPhase`, in place of the air's alone where the clouds are traced): four lobes, each with the share of every channel — the Rayleigh scattering, the haze's
 * Henyey-Greenstein lobe, and the two lobes of the cloud's dual Henyey-Greenstein phase (the cloud's scattering shared between them by the material's blend, each with its own anisotropy). The lobe of a sample is
 * chosen among the four by the share of its channels (`ptAirLobeCdf`: the Rayleigh against the haze, the two cloud lobes against each other, then the two pairs against each other).
 *
 * A point of the medium as it stands (`octave` 0) shares its scattering between the air's two and the cloud's by their coefficients at the point (the cloud's only for a path no rougher than the cutoff, the ones the clouds are marched for); an octave of the material's approximation of multiple scattering
 * is the cloud alone, an isotropic lobe of the share the approximation's phase factor gives (squared at each octave) and the cloud's dual lobe of the rest. `ptCloudFactorOf(octave)` is the share of the cloud's
 * extinction the octave's shadow rays see (1 for the medium as it stands, the approximation's occlusion factor, squared at each octave, else).
 */
export const PT_CLOUD_PHASE_WGSL = wgslBlock(
  'PT_CLOUD_PHASE_WGSL',
  [
    PT_AIR_WGSL,
    PT_AIR_LOBES_WGSL,
    PT_CLOUD_INTERSECT_WGSL,
    PT_SURFACE_WGSL,
    PI,
    hgPhase,
    frameAround,
    outOfFrame,
  ],
  `struct PtAirPhase{rayleigh:vec3f,mie:vec3f,g:f32,first:vec3f,second:vec3f,angles:vec2f,}
fn ptCloudFactorOf(octave:u32)->f32{
 var factor=1.0;
 if(octave>0u){factor=saturate(cloudMaterial.multiScatter.y);}
 for(var k=1u;k<octave;k++){factor*=factor;}
 return factor;
}
fn ptAirPhaseAt(position:vec3f,octave:u32,roughness:f32)->PtAirPhase{
 let data=ptCloudPhaseData();
 var p:PtAirPhase;
 p.angles=data.xy;
 if(octave>0u){
  var isotropic=saturate(cloudMaterial.multiScatter.z);
  for(var k=1u;k<octave;k++){isotropic*=isotropic;}
  p.mie=vec3f(isotropic);
  p.first=vec3f((1.0-isotropic)*(1.0-data.z));
  p.second=vec3f((1.0-isotropic)*data.z);
  return p;
 }
 let ray=ptAirRayOf(position,vec3f(0.0,1.0,0.0));
 let m=ptAirMediumAt(ptAirAltitude(ray.q));
 // A path rougher than the cutoff did not march the clouds (nor does it see them here): the air alone scatters.
 var dual=vec3f(0.0);
 if(roughness<=ptCloud.march.w){
  cloudMaterialStart(ptCloud.centre.w);
  let cloud=ptCloudDensityAt(position,ray.h);
  dual=cloud.albedo*cloud.extinction;
 }
 let rayleigh=m.rayleigh*0.001;
 let mie=m.mie*0.001;
 let s=rayleigh+mie+dual;
 p.rayleigh=select(vec3f(0.0),rayleigh/s,s>vec3f(0.0));
 p.mie=select(vec3f(0.0),mie/s,s>vec3f(0.0));
 p.first=select(vec3f(0.0),dual*(1.0-data.z)/s,s>vec3f(0.0));
 p.second=select(vec3f(0.0),dual*data.z/s,s>vec3f(0.0));
 p.g=ptAtmo.block[${ATMOSPHERE_SLOT.mieExtinction}].w;
 return p;
}
fn ptAirLobeWeight(w:vec3f)->f32{return w.x+w.y+w.z;}
fn ptAirLobeCdf(p:PtAirPhase)->vec3f{
 let a=ptAirLobeWeight(p.rayleigh);
 let b=ptAirLobeWeight(p.mie);
 let c=ptAirLobeWeight(p.first);
 let d=ptAirLobeWeight(p.second);
 let ab=ptMisBalance(a,b);
 let cd=ptMisBalance(c,d);
 let lr=ptMisBalance(a+b,c+d);
 return vec3f(ab*lr,lr,(lr+cd)-lr*cd);
}
fn ptAirPhaseLobes(p:PtAirPhase,cosView:f32,cdf:vec3f)->PtLobes{
 var lobes=PtLobes(vec3f(0.0),0.0);
 lobes=ptAddLobe(lobes,p.rayleigh,ptAirRayleighPhase(cosView),cdf.x);
 lobes=ptAddLobe(lobes,p.mie,hgPhase(p.g,cosView),cdf.y-cdf.x);
 lobes=ptAddLobe(lobes,p.first,hgPhase(p.angles.x,cosView),cdf.z-cdf.y);
 return ptAddLobe(lobes,p.second,hgPhase(p.angles.y,cosView),1.0-cdf.z);
}
fn ptAirSamplePhase(p:PtAirPhase,view:vec3f,e:vec3f)->PtSample{
 let cdf=ptAirLobeCdf(p);
 var forward=0.0;
 if(e.x<cdf.x){
  forward=ptAirRayleighInvert(ptRescale(e.x,0.0,cdf.x));
 }else if(e.x<cdf.y){
  forward=ptAirHgInvert(ptRescale(e.x,cdf.x,cdf.y),p.g);
 }else if(e.x<cdf.z){
  forward=ptAirHgInvert(ptRescale(e.x,cdf.y,cdf.z),p.angles.x);
 }else{
  forward=ptAirHgInvert(ptRescale(e.x,cdf.z,1.0),p.angles.y);
 }
 let sinTheta=sqrt(saturate(1.0-forward*forward));
 let phi=e.y*2.0*PI;
 let lobes=ptAirPhaseLobes(p,-forward,cdf);
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
 let lobes=ptAirPhaseLobes(p,dot(view,l),ptAirLobeCdf(p));
 return PtEval(lobes.weight,lobes.pdf);
}`,
)
