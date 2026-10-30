import {
  NO_SCENE_MASKS,
  sceneMaskKey,
  type SceneMaskPrograms,
} from '../rays/sceneTrace/sceneMaskPrograms.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { luminance } from '../../../../math/src/wgsl/color.ts'
import { SCENE_MASK_END, sceneMaskWgsl } from '../rays/sceneTrace/sceneMaskWgsl.ts'
import { sceneOccludedWgsl, sceneTraceWgsl } from '../rays/sceneTrace/sceneTraceWgsl.ts'
import { ATMOSPHERE_SLOT } from '../../../../sdk-core/src/scene/core/atmospherePack.ts'
import { PT_AIR_PHASE_WGSL, PT_GROUND_CLASS } from './airWgsl.ts'
import { PT_CLOUD_PHASE_WGSL } from './cloudPhaseWgsl.ts'
import { PT_HIT_KIND, PT_HIT_WGSL } from './hitRecordWgsl.ts'
import { PT_HIT_MATERIAL_VECS, PT_HIT_SURFACE_WGSL } from './hitMaterialWgsl.ts'
import { PT_LIGHT_GRID_WGSL } from './lightGridWgsl.ts'
import { PT_LIGHT_MAXIMUM } from './lightRecords.ts'
import { PT_LIGHTS_WGSL } from './lightsWgsl.ts'
import { PT_STATE_WGSL } from './pathWgsl.ts'
import { PT_VOLUME_LIGHTING_WGSL } from './volumeLightingWgsl.ts'
import { PT_RADIANCE_WGSL } from './radianceWgsl.ts'
import { PT_NO_CLASS } from './traceBounceWgsl.ts'
import { PT_ROUND_WGSL, PT_VIEW_FLAGS_WGSL, PT_VIEW_WGSL } from './viewWgsl.ts'

/** The bindings of the scene trace's group in the finish of a bounce, past the trace's and the any-hit test's: the hits the trace found and the materials the shade of the hits gave them. */
export const PT_FINISH_BINDINGS = { hits: SCENE_MASK_END, materials: SCENE_MASK_END + 1 } as const

/** The most lights a point picks among, the length of the table of the cumulative importances a thread keeps. */
const MAX_LIGHTS = PT_LIGHT_MAXIMUM

/** What a shadow ray lets through: the scene, the air, and, where the clouds are traced, the clouds (of the roughness the path had before the bounce, the extinction scaled by the share the octave the event stands for keeps) for a light that casts a shadow from them. */
const AIR_VISIBLE = `fn ptVisibleRgb(path:ptr<function,PtPath>,origin:vec3f,direction:vec3f,tMax:f32,casts:bool)->vec3f{
 return ptVisible(origin,direction,tMax,casts)*ptAirVisible(path,origin,direction,tMax,casts);
}`
const CLOUD_VISIBLE = `var<private> ptCloudFactor:f32;
var<private> ptPreviousRoughness:f32;
fn ptLightCastsCloudShadow(id:u32)->bool{return directLights.lights[id].extra.y>0.0;}
fn ptVisibleRgb(path:ptr<function,PtPath>,origin:vec3f,direction:vec3f,tMax:f32,casts:bool,cloudCasts:bool)->vec3f{
 let seen=ptVisible(origin,direction,tMax,casts)*ptAirVisible(path,origin,direction,tMax,casts);
 if(!casts||!cloudCasts||!any(seen>vec3f(0.0))){return seen;}
 return seen*ptCloudVisible(path,origin,direction,tMax,ptPreviousRoughness,ptCloudFactor);
}`

/**
 * THE REST OF A BOUNCE (`ptFinishBounce(path, bounce, index)`), once the trace found what the path's ray meets (`ptHits`) and the shade of the hits gave it its material (`ptMaterials`, `PtHitMaterial`): one
 * surface of a path, true while the path goes on.
 *
 * 1. The surface: a hit of the trace is a `PtSurface` by `ptHitSurface` (`ptSurfaceOfHitMaterial`, the medium of a glass a ray left by its back face taking its share of the throughput, a material that lets light through being a glass at the proportion of its hits its `transmission` says; the roughness of every surface is held over that of the path that reached it where the caustics are
 *    approximated, `ptView.limits.y`; a surface no class shades is a dielectric of reflectance 0.04, roughness 1, colour one half); the camera's hit also keeps its depth, as the frame stores it, for the depth the
 *    display writes. A camera ray that meets nothing escapes (its depth stays 0, the far plane); any other ray that meets nothing ends the path, as does the last bounce with emissive surfaces off.
 *    A surface whose opacity is under one covers the ray in that proportion of its hits (a draw of the path's sequence); a ray it does not cover goes on from the other side of the surface, along the same direction, in the next
 *    round of the same bounce (`ptPassedThrough`; the reference multiplies the throughput by the transparency and keeps one of the hits of the run by chance in the loop of one bounce; the draw replaces both and the
 *    rounds are the loop, at most `PT_PASS_ROUNDS` of them and none where no surface of the scene has an opacity under one: a wavefront encodes a bound where the reference loops until the ray's start passes its end), and still counts as the camera's.
 * 2. What the camera sees of the lights (`pathTracingVisibleLights`): a light in front of the first surface adds its radiance (the sun and the sky behind nothing are seen by a ray
 *    that escapes); an escaped ray adds the background alpha.
 * 3. The emission of the surface, the albedo and normal the denoiser gets, and the end of the path on a surface that gives no light back (black).
 * 4. The light by sampling the lights (mode 1 and 2): the lights the grid keeps at the point and the lights at infinity are weighed by `ptEstimateLight` (and by their indirect factor once the
 *    path has scattered), one is chosen by the cumulative table (a binary search), sampled, the surface's BSDF evaluated toward the sample, and, in mode 2, the contribution weighed against
 *    the density the material would have had of choosing that direction (`ptMisPower`); a light that casts shadows is tested by a ray to it from the point moved off the surface.
 * 5. The next direction (`ptSampleMaterial`): a sample whose density is not a number paints the pixel magenta and ends the path; one with none ends it; a throughput with no light left ends it.
 *    Russian roulette keeps the path with the root of the share of the brightest channel of the throughput that remains (the path then carries the throughput over it).
 *    The ray is moved off the surface, the path roughness raised to the lobe's.
 * 6. The light by the material's sample (mode 0 and 2): every light the new ray meets (`ptTraceLight`, in front of nothing: a light is not geometry) adds its radiance by the new throughput,
 *    weighed in mode 2 against the density sampling that light would have had (the table's share of the light times its density), the shadow tested as above.
 * 7. The first scatter that is not a refraction is kept (a path refracted into a glass counts as the camera's until it scatters off something else); the path goes on if this is not the bounce before the last, or if emissive surfaces light the scene.
 * Where the lamps light the volume by a point drawn on the ray (`pathTracingVolumeMISMode` 1, `ptVolumeLights`), that light is gathered first, whatever the ray meets, and the event of the air lights by the lights at infinity alone.
 * Where the clouds are traced (`clouds`), the event of the air can be one of the clouds: its phase is the four lobes of `PT_CLOUD_PHASE_WGSL`, a shadow ray toward a light that casts cloud shadows (or from the medium) also crosses the clouds (`ptCloudVisible`), and the octave of the approximation of
 * multiple scattering an event stands for lights its point and ends the path.
 */
export const PT_FINISH_BOUNCE_WGSL = (
  scene: { group: number; first: number },
  programs: SceneMaskPrograms = NO_SCENE_MASKS,
  clouds = false,
) =>
  wgslBlock(
    `PT_FINISH_BOUNCE_WGSL(${scene.group},${scene.first},${sceneMaskKey(programs)}${clouds ? ',clouds' : ''})`,
    [
      luminance,
      PT_VIEW_WGSL,
      PT_ROUND_WGSL,
      PT_VIEW_FLAGS_WGSL,
      PT_STATE_WGSL,
      PT_RADIANCE_WGSL,
      PT_LIGHTS_WGSL,
      PT_LIGHT_GRID_WGSL,
      PT_HIT_WGSL,
      PT_HIT_SURFACE_WGSL,
      PT_VOLUME_LIGHTING_WGSL(clouds),
      clouds ? PT_CLOUD_PHASE_WGSL : PT_AIR_PHASE_WGSL,
      sceneTraceWgsl(scene.group, scene.first),
      sceneMaskWgsl(scene.group, scene.first, programs),
      sceneOccludedWgsl(scene.group, scene.first),
    ],
    `@group(${scene.group}) @binding(${scene.first + PT_FINISH_BINDINGS.hits}) var<storage,read> ptHits:array<vec4u>;
@group(${scene.group}) @binding(${scene.first + PT_FINISH_BINDINGS.materials}) var<storage,read> ptMaterials:array<vec4u>;
const PT_LIGHT_TABLE:u32=${MAX_LIGHTS}u;
var<private> ptPassedThrough:bool;
// Set by the views of the payload, which take the surface as its material gives it, with no draw for its coverage or its glass.
var<private> ptShowing:bool;
fn ptMax3(v:vec3f)->f32{return max(v.x,max(v.y,v.z));}
fn ptScattered(path:ptr<function,PtPath>)->bool{return (*path).scatter==PT_SCATTER_DIFFUSE||(*path).scatter==PT_SCATTER_SPECULAR;}
fn ptVisible(origin:vec3f,direction:vec3f,tMax:f32,casts:bool)->f32{
 if(!casts){return 1.0;}
 return select(1.0,0.0,stOccluded(StRay(origin,direction,0.0,tMax,ST_ANY_HIT|ST_SHADOW|ST_SKIP_TRANSLUCENT|ST_PATH_RAY)));
}
${clouds ? CLOUD_VISIBLE : AIR_VISIBLE}
fn ptAccumulateAov(path:ptr<function,PtPath>,s:PtSurface){
 let weight=1.0-saturate(((*path).roughness-0.10)/(0.15-0.10));
 if(weight==0.0){return;}
 let throughput=(*path).throughput*weight;
 let strength=clamp((s.roughness-max(0.10,(*path).roughness))/(0.15-max(0.10,(*path).roughness)),0.0,1.0);
 let lobes=select(s.diffuse+s.transmit+s.f0*strength,vec3f(strength),s.glass);
 (*path).albedo+=throughput*(lobes+s.fuzz*s.fuzzColor);
 (*path).normal+=luminance(throughput)*s.normal;
}
fn ptSelectLight(r:f32,count:u32,cdf:ptr<function,array<f32,${MAX_LIGHTS}>>)->vec2f{
 var id=0u;
 var left=count;
 while(left>0u){
  let stride=left/2u;
  let at=id+stride;
  if(r<(*cdf)[at]){left=stride;}else{id=at+1u;left-=stride+1u;}
 }
 id=min(id,count-1u);
 var pdf=(*cdf)[id];
 if(id>0u){pdf-=(*cdf)[id-1u];}
 return vec2f(f32(id),pdf);
}
fn ptHitSurface(h:PtHit,index:u32,path:ptr<function,PtPath>)->PtSurface{
 var s:PtSurface;
 if(h.classKey==${PT_NO_CLASS}u||h.classKey==${PT_GROUND_CLASS}u){
  s.position=h.position;
  s.geoNormal=h.geoNormal;
  s.normal=h.normal;
  s.vertexNormal=select(-h.normal,h.normal,dot(h.normal,h.geoNormal)>=0.0);
  s.diffuse=vec3f(0.5);
  s.f0=vec3f(0.04);
  s.roughness=1.0;
  s.emission=vec3f(0.0);
  s.hitT=h.distance;
  s.opacity=1.0;
  s.selection=1.0;
  s.ior=1.5;
  s.front=h.front;
  // The planet's ground under the traced air is a diffuse surface of the air's ground albedo.
  if(h.classKey==${PT_GROUND_CLASS}u){
   s.diffuse=ptAtmo.block[${ATMOSPHERE_SLOT.ground}].xyz;
   s.f0=vec3f(0.0);
  }
 }else{
  let m=ptUnpackHitMaterial(ptMaterials[index*${PT_HIT_MATERIAL_VECS}u],ptMaterials[index*${PT_HIT_MATERIAL_VECS}u+1u],ptMaterials[index*${PT_HIT_MATERIAL_VECS}u+2u]);
  s=ptSurfaceOfHitMaterial(m,h.position,h.geoNormal,h.normal,h.distance,h.front);
  // A surface whose opacity is under one covers the ray in that proportion of its hits; the ray goes through the rest as it came, untouched, and is traced again from the other side in the next round of the bounce
  // (the last round has every surface cover it).
  if(s.opacity<1.0&&!ptShowing){
   // The draw is made in every round, so that the dimensions after it stay where they are.
   let covers=ptRand1(&(*path).rand)<s.opacity;
   if(!covers&&ptRound()<ptRounds()){
    ptPassedThrough=true;
    return s;
   }
  }
  if(m.transmission>0.0&&!ptShowing){
   // A glass of walls with no thickness is a pane with no inside: the ray crosses no medium, the law of the medium is the colour of the slab for a unit length.
   let thin=m.thickness<=0.0;
   // A ray that meets the back of a solid glass crossed its medium: the law of the medium (2^(attenuation · distance) a channel) takes its share.
   if(!h.front&&!thin){(*path).throughput*=exp2(m.attenuation*h.distance);}
   // The surface is a glass in the proportion the material lets light through, the pick weighing what it chose by one over its chance.
   let glass=ptRand1(&(*path).rand)<m.transmission;
   s.glass=glass;
   s.thin=glass&&thin;
   s.tint=exp2(m.attenuation);
   s.selection=select(1.0/(1.0-m.transmission),1.0/m.transmission,glass);
  }
 }
 s.roughness=max(s.roughness,ptView.limits.y*(*path).roughness);
 return s;
}
fn ptLoadHit(index:u32)->PtHit{
 return ptUnpackHit(array<vec4u,6>(ptHits[index*6u],ptHits[index*6u+1u],ptHits[index*6u+2u],ptHits[index*6u+3u],ptHits[index*6u+4u],ptHits[index*6u+5u]));
}
fn ptFinishBounce(path:ptr<function,PtPath>,bounce:u32,index:u32)->bool{
 let maxBounces=ptView.seeds.y;
 let lastBounce=bounce==maxBounces;${clouds ? '\n ptPreviousRoughness=(*path).roughness;\n ptCloudFactor=1.0;' : ''}
 let emissive=ptEmissive();
 // The camera's until the path has scattered or refracted: the bounces that only went through coverage are still the first hit's.
 let camera=(*path).scatter==PT_SCATTER_CAMERA;
 let h=ptLoadHit(index);
 if(h.kind==${PT_HIT_KIND.ended}u){(*path).throughput=vec3f(0.0);return false;}
 // The lamps light the stretch of the volume the walk went through by a point drawn on it, whatever the ray meets (the events the walk kept then light by the lights at infinity alone).
 if(ptAirOn()&&ptAirVolumeLights()&&!lastBounce){ptVolumeLights(path,h,camera);}
 var s:PtSurface;
 var escaped=false;
 // A scattering event of the air the trace kept for the bounce (the surface, if any, competes with it for the path).
 let pending=any((*path).eventThroughput>vec3f(0.0));
 if(h.kind==${PT_HIT_KIND.escaped}u){
  if(!camera&&!pending){return false;}
  escaped=true;
  s.hitT=PT_T_MAX;
 }else{
  s=ptHitSurface(h,index,path);
 }
 if(camera&&ptView.flags.y!=0u){
  let reach=s.hitT;
  for(var id=0u;id<ptView.counts.x;id++){
   if(ptView.flags.y==2u&&ptLightKind(id)!=PT_LIGHT_SKY){continue;}
   let seen=ptTraceLight((*path).origin,(*path).direction,0.0,reach,id);
   if(seen.hitT>0.0){ptAccumulate(path,(*path).throughput*seen.radiance,true);}
  }
 }
 if(ptPassedThrough){
  (*path).origin=ptRayBias(s.position,s.hitT,-s.geoNormal);
  return true;
 }
 if(camera&&!escaped){
  let clip=ptView.viewProjection*vec4f(s.position+ptView.eye.xyz,1.0);
  (*path).depth=clip.z/clip.w;
 }
 if(escaped){
  if(camera){(*path).alpha+=luminance((*path).throughput)*ptView.limits.z;}
  if(!pending){return false;}
 }else{
  if(camera){(*path).alpha+=luminance((*path).throughput);}
  if(emissive){ptAccumulate(path,(*path).throughput*s.emission,camera);}
  if(lastBounce){return false;}
  ptAccumulateAov(path,s);
 }
 // The air: the surface and the events of the air the trace kept compete for the path in one reservoir; the path goes on from the winner with the throughput that makes the choice fair.
 var medium=false;
 var phase:PtAirPhase;
 if(ptAirOn()){
  var surfaceWins=false;
  if(!escaped){
   let w=ptMax3((*path).throughput*ptMaterialAlbedo(s));
   surfaceWins=ptRisAccept(path,w);
   if(surfaceWins){(*path).throughput*=(*path).risSum/w;}
  }
  if(!surfaceWins){
   (*path).throughput=(*path).eventThroughput*(*path).risSum;
   if(!(ptMax3((*path).throughput)>0.0)){return false;}
   medium=true;
   s=PtSurface();
   s.position=(*path).eventPosition;
   s.hitT=1.0;
   s.normal=-(*path).direction;
   phase=ptAirPhaseAt(s.position${clouds ? ',(*path).octave,(*path).roughness' : ''});${clouds ? '\n   ptCloudFactor=ptCloudFactorOf((*path).octave);' : ''}
  }
 }
 if(!medium&&!(ptMax3((*path).throughput*ptMaterialAlbedo(s))>0.0)){return false;}
 let view=-(*path).direction;
 var bsdf:PtBsdf;
 if(!medium){bsdf=ptPrepareBsdf(s,view);}
 let r=ptRand4(&(*path).rand);
 var sampled:PtSample;
 if(medium){sampled=ptAirSamplePhase(phase,view,r.xyz);}else{sampled=ptSampleMaterial(s,bsdf,r.xyz);}
 let misMode=ptView.seeds.z;
 var cell=ptGridLookup(s.position);
 if(medium&&ptAirVolumeLights()){
  cell.lights=min(cell.lights,ptGridParams.infinite);
  cell.mis=min(cell.mis,ptGridParams.infinite);
 }
 let transmissive=s.glass||any(s.transmit>vec3f(0.0));
 let scattered=ptScattered(path);
 var cdf:array<f32,${MAX_LIGHTS}>;
 var cdfSum=0.0;
 if(misMode!=0u){
  for(var i=0u;i<cell.lights;i++){
   let id=ptGridLightId(i,cell);
   var estimate=ptEstimateLight(id,s.position,s.normal);
   if(scattered){estimate*=ptLightIndirectScale(id,(*path).roughness);}
   cdfSum+=estimate;
   cdf[i]=cdfSum;
  }
  if(cdfSum>0.0){
   let picked=ptSelectLight(r.z*cdfSum,cell.lights,&cdf);
   let id=ptGridLightId(u32(picked.x),cell);
   let pick=picked.y/cdfSum;
   var ls=ptSampleLight(id,r.xy,s.position,s.normal);
   ls.radianceOverPdf/=pick;
   ls.pdf*=pick;
   if(ls.pdf>0.0){
    if(medium){ls.radianceOverPdf*=ptLightScattering(id);}
    if(scattered){ls.radianceOverPdf*=ptLightIndirectScale(id,(*path).roughness);}
    if(any(ls.radianceOverPdf>vec3f(0.0))){
     var evaluated:PtEval;
     if(medium){evaluated=ptAirEvalPhase(phase,view,ls.direction);}
     else{evaluated=ptEvalMaterial(s,bsdf,ls.direction,vec2f(ptLightDiffuseScale(id),ptLightSpecularScale(id)));}
     var contribution=(*path).throughput*ls.radianceOverPdf*evaluated.weight*evaluated.pdf;
     if(misMode==2u){contribution*=ptMisPower(ls.pdf,evaluated.pdf);}
     if(any(contribution>vec3f(0.0))){
      // A surface that lets light through is lit from the side the light is on.
      let side=select(1.0,sign(dot(s.geoNormal,ls.direction)),transmissive);
      contribution*=ptVisibleRgb(path,ptRayBias(s.position,s.hitT,side*s.geoNormal),ls.direction,ls.distance,select(ptLightCastsShadow(id),ptLightCastsVolumeShadow(id),medium)${clouds ? ',ptLightCastsCloudShadow(id)||medium' : ''});
      ptAccumulate(path,contribution,camera);
     }
    }
   }
  }
 }
 if(bitcast<u32>(sampled.pdf)>0x7f800000u){
  (*path).radiance=vec3f(1.0,0.0,1.0);
  return false;
 }
 if(!(sampled.pdf>0.0)){return false;}
 let next=(*path).throughput*sampled.weight;
 if(!any(next>vec3f(0.0))){return false;}
 let keep=sqrt(saturate(ptMax3(next)/ptMax3((*path).throughput)));
 if(keep<1.0){
  if(r.w>=keep){return false;}
  (*path).throughput=next/keep;
 }else{
  (*path).throughput=next;
 }
 (*path).origin=ptRayBias(s.position,s.hitT,sampled.positionBias*s.geoNormal);
 (*path).direction=sampled.direction;
 let previousRoughness=(*path).roughness;
 (*path).roughness=max(previousRoughness,sampled.roughness);
 if(misMode!=1u){
  let useMis=misMode==2u&&cdfSum>0.0;
  var previousCdf=0.0;
  for(var i=0u;i<cell.mis;i++){
   let id=ptGridLightId(i,cell);
   let cdfValue=cdf[i];
   let pick=(cdfValue-previousCdf)/cdfSum;
   previousCdf=cdfValue;
   let met=ptTraceLight((*path).origin,(*path).direction,0.0,PT_T_MAX,id);
   if(met.hitT<=0.0){continue;}
   var contribution=(*path).throughput*met.radiance;
   contribution*=select(select(ptLightSpecularScale(id),ptLightDiffuseScale(id),sampled.scatter==PT_SCATTER_DIFFUSE),ptLightScattering(id),medium);
   if(useMis){contribution*=ptMisPower(sampled.pdf,met.pdf*pick);}
   if(scattered){contribution*=ptLightIndirectScale(id,previousRoughness);}
   if(any(contribution>vec3f(0.0))){
    contribution*=ptVisibleRgb(path,(*path).origin,(*path).direction,met.hitT,select(ptLightCastsShadow(id),ptLightCastsVolumeShadow(id),medium)${clouds ? ',ptLightCastsCloudShadow(id)||medium' : ''});
    ptAccumulate(path,contribution,camera);
   }
  }
 }
 ${clouds ? '// An octave of the approximation of multiple scattering lights and goes no further, whatever share of the extinction it keeps (the reference tells it by that share being under one, so with a share of one the octave bounced and counted its light twice).\n if(medium&&(*path).octave>0u){return false;}\n ' : ''}if((*path).scatter==PT_SCATTER_CAMERA||(*path).scatter==PT_SCATTER_REFRACT){(*path).scatter=sampled.scatter;}
 return bounce+1u<maxBounces||emissive;
}`,
  )
