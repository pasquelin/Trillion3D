import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { ATMOSPHERE_SLOT } from '../../../../../sdk-core/src/scene/core/atmospherePack.ts'
import { VIEW_SLOT } from '../../../lighting/atmosphere/layout.ts'
import { CLOUD_MATERIAL_WGSL } from './materialWgsl.ts'

/**
 * THE MATERIAL AT A POINT of the cloud layer, for the programs that read it along a ray from the
 * eye: the view tracing and the shadow map's. The program that includes it declares the air's
 * frame (`frame`), the material (`cloudMaterialBindings`) and calls `cloudPointStart` once
 * for the pass's thread, with its layer (the base altitude and the thickness in kilometres and the
 * time in seconds) and the planet's radius in kilometres (`cloudPlanetKm`).
 */
export const CLOUD_POINT_WGSL = wgslBlock(
  'CLOUD_POINT_WGSL',
  [CLOUD_MATERIAL_WGSL],
  `
var<private> cloudSceneEye:vec3f;
var<private> cloudPlanetEye:vec3f;
var<private> cloudBottomCm:f32;
var<private> cloudToNorm:f32;
var<private> cloudTime:f32;
/** The planet's radius, kilometres: the air's where the air is present, else the part's. */
fn cloudPlanetKm(airPresent:bool,partKm:f32)->f32{return select(partKm,bottomRadius(),airPresent);}
/** The eye in the scene and from the planet's centre, the layer's bottom over a planet of radius
 *  \`planetKm\` and the scale of its altitude, the time, and the material's own
 *  (\`cloudMaterialStart\`). */
fn cloudPointStart(layer:vec3f,planetKm:f32){
 cloudSceneEye=frame.eye.xyz*CLOUD_M_TO_CM;
 cloudPlanetEye=frame.camera.xyz*CM_PER_KM;
 cloudBottomCm=(planetKm+layer.x)*CM_PER_KM;
 cloudToNorm=1.0/(layer.y*CM_PER_KM);
 cloudTime=layer.z;
 cloudMaterialStart(layer.z);
}
struct CloudPoint{spot:CloudSample,norm:f32,}
/** The material at the point \`rel\` centimetres from the eye, with its altitude in the layer. */
fn cloudPointAt(rel:vec3f)->CloudPoint{
 var p:CloudPoint;
 p.norm=saturate((length(cloudPlanetEye+rel)-cloudBottomCm)*cloudToNorm);
 let at=cloudSceneEye+rel;
 p.spot=cloudMaterialAt(vec3f(at.x,at.z,at.y),p.norm,rel,cloudTime);
 return p;
}`,
)

/**
 * THE LIGHT OF ONE SAMPLE of the view tracing: what the lights of the air and the sky give the
 * point of the cloud a ray has reached, and what the point does to the ray.
 *
 * Lengths are centimetres, as the tracing works; the material's extinction is per metre. The
 * program that includes it declares the trace block (`cloudTrace`, `traceLayout.ts`), the air's
 * buffer and frame (`frame`, `directLights`), the material (`cloudMaterialBindings`) and the
 * transmittance table.
 *
 * - The scene's points are given as `rel`, centimetres from the eye along the scene's axes; the
 *   planet's centre is where the air puts it, so a point's altitude in the layer is its distance
 *   from that centre less the layer's bottom radius. The material reads the point with the scene's
 *   height as its third axis.
 * - A light is lit by the air's block: its illuminance outside the air, times the air's
 *   transmittance toward it at the ground, or, with the tint taken at each sample, outside the air
 *   and the air's transmittance toward it at the point; times the light's scattered luminance
 *   scale, nothing where the air's lights do not light the cloud.
 * - The sky light, where the distant sky light lights the cloud, is the mean radiance of the sky
 *   the air keeps for the haze, times the material's occlusion, or, where the material gives none,
 *   the gradient of the cloud's underside (`undersideSkyLoss`).
 * - Multiple scattering takes `count` orders; the order after another has its scattering, its
 *   extinction and its phase's share of the lobe each squared once more than the one before.
 * - The shadow toward a light is marched through the material from the point, its samples spread
 *   by their square along the ray; it ends where the ray leaves the layer.
 */
export const CLOUD_LIGHT_WGSL = wgslBlock(
  'CLOUD_LIGHT_WGSL',
  [CLOUD_POINT_WGSL],
  `
/** The shadow ray's samples sit mid-segment. */
const CLOUD_SHADOW_JITTER:f32=0.5;
/** The smallest extinction an integral divides by. */
const CLOUD_SAFE_EXTINCTION:f32=0.000001;
var<private> cloudShadowEach:f32;
/** The pass's point (\`cloudPointStart\`), the shadow samples' step, once for the pass's thread. */
fn cloudStart(){
 cloudPointStart(cloudTrace.layer.xyz,cloudPlanetKm(cloudTrace.counts.w==1u,cloudTrace.sky.x));
 cloudShadowEach=1.0/floor(cloudTrace.samples.y);
}
/** The orders of multiple scattering: for each, its share of the scattering, of the extinction
 *  and of the phase's lobe against the uniform phase. */
struct CloudOctaves{count:u32,scatter:array<f32,3>,extinction:array<f32,3>,lobe:array<f32,3>,}
fn cloudOctaves()->CloudOctaves{
 let ms=cloudMaterial.multiScatter;
 var o:CloudOctaves;
 o.count=1u+u32(ms.w);
 o.scatter[0]=1.0;
 o.extinction[0]=1.0;
 o.lobe[0]=1.0;
 var s=saturate(ms.x);
 var e=saturate(ms.y);
 var l=saturate(ms.z);
 for(var k=1u;k<o.count;k++){
  o.scatter[k]=o.scatter[k-1u]*s;
  o.extinction[k]=o.extinction[k-1u]*e;
  o.lobe[k]=l;
  s*=s;
  e*=e;
  l*=l;
 }
 return o;
}
/** The phase of the two lobes blended, for a ray that makes \`cosTheta\` with the light. */
fn cloudPhase(cosTheta:f32)->f32{
 let p=cloudMaterial.phase;
 let first=hgPhase(clamp(p.x,-0.999,0.999),-cosTheta);
 let second=hgPhase(clamp(p.y,-0.999,0.999),-cosTheta);
 return first+clamp(p.z,0.0,1.0)*(second-first);
}
/** A light of the air: the direction toward it, its illuminance before the cloud's scale (\`raw\`, what
 *  the ground bounces) and after it, the phase toward the ray. */
struct CloudLight{toward:vec3f,raw:vec3f,illuminance:vec3f,phase:f32,}
struct CloudLights{list:array<CloudLight,2>,count:u32,sky:vec3f,}
/** The lights of the air for a ray along \`dir\`, and the sky light. */
fn cloudLights(dir:vec3f)->CloudLights{
 let suns=airSuns();
 var l:CloudLights;
 l.count=suns.count;
 for(var k=0u;k<suns.count;k++){
  let second=k==1u;
  let outer=select(atmo(${ATMOSPHERE_SLOT.sunIlluminance}u).xyz,atmo(${ATMOSPHERE_SLOT.secondIlluminance}u).xyz,second);
  let ground=select(atmo(${ATMOSPHERE_SLOT.sunTransmittance}u).xyz,atmo(${ATMOSPHERE_SLOT.secondTransmittance}u).xyz,second);
  l.list[k].toward=suns.list[k].toward;
  let scale=select(cloudTrace.lightScale0.xyz,cloudTrace.lightScale1.xyz,second)*f32(cloudTrace.switches.w);
  l.list[k].raw=select(outer*ground,outer,cloudTrace.sizes.y==1u);
  l.list[k].illuminance=l.list[k].raw*scale;
  l.list[k].phase=cloudPhase(dot(suns.list[k].toward,dir));
 }
 l.sky=directLights.atmosphereView[${VIEW_SLOT.haze}].xyz*f32(cloudTrace.switches.z);
 return l;
}
/** What the cloud lets through toward a light from the point \`rel\`, for each order: the extinction
 *  of the material marched along \`toward\`, its samples spread by their square. */
fn cloudShadow(rel:vec3f,toward:vec3f,o:CloudOctaves)->array<vec3f,3>{
 var acc=array<vec3f,3>(vec3f(0.0),vec3f(0.0),vec3f(0.0));
 let reach=cloudTrace.samples.z;
 let each=cloudShadowEach;
 var before=0.0;
 for(var s=each;s<=1.00001;s+=each){
  let after=s*s;
  let share=after-before;
  let there=cloudPointAt(rel+toward*(reach*(before+share*CLOUD_SHADOW_JITTER)));
  before=after;
  if(there.spot.conservativeDensity.x<=0.0){continue;}
  if(there.norm<=0.0||there.norm>=1.0){break;}
  for(var m=0u;m<o.count;m++){acc[m]+=there.spot.extinction*o.extinction[m]*share;}
 }
 var through:array<vec3f,3>;
 for(var m=0u;m<o.count;m++){through[m]=exp(-acc[m]*(reach*CLOUD_CM_TO_M));}
 return through;
}
/** A ray's running sums: the light gathered, what it still lets through, and the sums that give
 *  the mean distance of the cloud it met, weighted by what it let through. */
struct CloudAccum{luminance:vec3f,transmittance:vec3f,tapSum:f32,tapWeights:f32,}
/** What a ray gathers: all the samples (\`seen\`), and those before the nearest surface of the pixel's
 *  block (\`nearest\`). */
struct CloudMarched{seen:CloudAccum,nearest:CloudAccum,}
/** The air's transmittance toward each light from the planet-relative point \`planetKm\`: one where
 *  the tint is taken once per ray. */
fn cloudAirToLights(planetKm:vec3f,lights:CloudLights)->array<vec3f,2>{
 var air=array<vec3f,2>(vec3f(1.0),vec3f(1.0));
 if(cloudTrace.sizes.y!=1u){return air;}
 for(var k=0u;k<lights.count;k++){air[k]=transmittanceToward(planetKm,lights.list[k].toward);}
 return air;
}
/** What the light of each order loses on the way to the sample: the air's transmittance, the sun's
 *  shadow in the opaque scene (the first light alone), and the cloud's own shadow toward each light. */
fn cloudShadowsToLights(rel:vec3f,air:array<vec3f,2>,lights:CloudLights,o:CloudOctaves)->array<array<vec3f,3>,2>{
 var toLight:array<array<vec3f,3>,2>;
 for(var k=0u;k<lights.count;k++){
  for(var m=0u;m<o.count;m++){toLight[k][m]=air[k];}
 }
 if(lights.count>0u){
  let opaque=cloudOpaqueShadow(rel);
  for(var m=0u;m<o.count;m++){toLight[0][m]*=opaque;}
 }
 for(var k=0u;k<lights.count;k++){
  let shadow=cloudShadow(rel,lights.list[k].toward,o);
  for(var m=0u;m<o.count;m++){toLight[k][m]*=shadow[m];}
 }
 return toLight;
}
/** The sample counted in the sums that give the ray's mean distance, weighted by what it lets through. */
fn cloudTapSums(t:f32,contributes:bool,extinction:vec3f,march:ptr<function,CloudMarched>){
 if(!any(extinction>vec3f(0.0))){return;}
 let tr=(*march).seen.transmittance;
 let weight=min(min(tr.x,tr.y),tr.z);
 (*march).seen.tapSum+=t*weight;
 (*march).seen.tapWeights+=weight;
 if(contributes){
  (*march).nearest.tapSum+=t*weight;
  (*march).nearest.tapWeights+=weight;
 }
}
/**
 * One sample's contribution, \`dtMeters\` long at \`t\`, at altitude \`norm\` in the layer: the light of each order, from the most
 * scattered down to the first, integrated against the extinction over the step, added to \`seen\`
 * with what the ray still lets through; the first order lessens that. \`nearest\` gathers the same for
 * the samples before \`closestCm\`, the nearest surface of the pixel's block: a sample at \`closestCm\`
 * is counted in its sums and its light, not in what it still lets through. The ground's bounce
 * (the material's choice) joins the sky light of the first order, while the ray still lets some
 * light through; the lamps' light joins every order.
 */
fn cloudSampleStep(rel:vec3f,t:f32,norm:f32,spot:CloudSample,lights:CloudLights,o:CloudOctaves,dtMeters:f32,closestCm:f32,march:ptr<function,CloudMarched>){
 let contributes=t<=closestCm;
 let planetKm=(cloudPlanetEye+rel)/CM_PER_KM;
 let scattering=spot.albedo*spot.extinction;
 let air=cloudAirToLights(planetKm,lights);
 var toLight:array<array<vec3f,3>,2>;
 var sky=lights.sky*select(saturate(cloudTrace.sky.y+norm),spot.ambientOcclusion,cloudTrace.sky.z==1.0);
 if(any(scattering>vec3f(0.0))){
  let seen=(*march).seen.transmittance;
  if(cloudMaterial.ground.x>0.5&&max(max(seen.x,seen.y),seen.z)>0.01){sky+=cloudGroundLight(rel,air,lights);}
  toLight=cloudShadowsToLights(rel,air,lights,o);
 }else{
  for(var k=0u;k<lights.count;k++){for(var m=0u;m<o.count;m++){toLight[k][m]=air[k];}}
 }
 cloudTapSums(t,contributes,spot.extinction,march);
 let lamps=cloudLocalLights(rel,o);
 for(var j=0u;j<o.count;j++){
  let m=o.count-1u-j;
  var light=select(vec3f(0.0),sky,m==0u)+lamps[m];
  for(var k=0u;k<lights.count;k++){
   light+=toLight[k][m]*lights.list[k].illuminance*mix(UNIFORM_PHASE,lights.list[k].phase,o.lobe[m]);
  }
  let scattered=light*(scattering*o.scatter[m])+spot.emissive;
  let extinction=max(spot.extinction*o.extinction[m],vec3f(CLOUD_SAFE_EXTINCTION));
  let kept=exp(-extinction*dtMeters);
  let gathered=(*march).seen.transmittance*((scattered-scattered*kept)/extinction);
  (*march).seen.luminance+=gathered;
  if(contributes){(*march).nearest.luminance+=gathered;}
  if(m==0u){
   (*march).seen.transmittance*=kept;
   if(closestCm>t){(*march).nearest.transmittance*=kept;}
  }
 }
}
`,
)
