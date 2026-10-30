import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { sampleCone } from '../../../../../math/src/wgsl/coneSampling.ts'
import { sampleSphereEven } from '../../../../../math/src/wgsl/sampling.ts'
import {
  buildSphericalRect,
  sampleSphericalRect,
} from '../../../../../math/src/wgsl/sphericalRect.ts'
import { FULLSCREEN_VERTEX } from '../../../gpu/shader/fullscreenTriangle.ts'
import { MODEL_FLAG, SURFACE_MODEL_MASK } from '../../../materials/surface/surfaceModelWord.ts'
import { isFirstPerson } from '../../../materials/surface/surfaceModel.ts'
import { PIXEL_MODEL, pixelModelOf } from '../../../materials/surface/pixelModel.ts'
import { SUBSURFACE_FLAG } from '../../../materials/surface/subsurface.ts'
import { channelsOfFlags } from '../../../materials/surface/surfaceChannels.ts'
import { SHADOW_HIT_INVALID, SHADOW_HIT_MISS } from '../denoise/shadowDenoiseCommonWgsl.ts'
import { DIRECT_LIGHT_WGSL } from '../../direct/lightWgsl.ts'
import { lightChannelsOf, lightTraits } from '../../direct/lightReachWgsl.ts'
import { LIGHT_CAPSULE_WGSL } from '../../manyLightsSampled/lightTraceWgsl.ts'
import { WORLD_AT_WGSL } from '../../deferred/worldAtWgsl.ts'
import { PT_RANDOM_WGSL } from '../../pathTracing/randomWgsl.ts'
import { NO_SCENE_MASKS, type SceneMaskPrograms } from '../../rays/sceneTrace/sceneMaskPrograms.ts'
import { sceneMaskWgsl } from '../../rays/sceneTrace/sceneMaskWgsl.ts'
import { sceneTraceWgsl } from '../../rays/sceneTrace/sceneTraceWgsl.ts'
import { REFLECTION_CONSTANTS_WGSL } from '../../reflections/constantsWgsl.ts'
import {
  REFLECTION_GROUP,
  reflectionBindingsWgsl,
  reflectionLightViewWgsl,
} from '../../reflections/viewLayout.ts'

/** The side of a workgroup, in threads. */
export const RAY_TRACED_GROUP = 8
/** The scene trace's group and its first binding in it (the reflection group is the one before). */
export const RAY_TRACED_SCENE = { group: 2, first: 0 } as const

/** The bindings of group 0. The cut's tables the scene trace walks are at the culling's bindings of that group (1, 6, 7 and 9): none of these is. */
export const RAY_TRACED_BINDINGS = {
  params: 0,
  normals: 2,
  flags: 3,
  mask: 4,
  lights: 5,
  hits: 8,
  subsurface: 10,
} as const
const B = RAY_TRACED_BINDINGS

export const RAY_TRACED_ENTRY = 'rayTracedShadow'

/** The reach of a sun's ray: the sun has no end to be stopped at. */
export const RAY_TRACED_SUN_REACH = '1.0e27'

/**
 * THE RAY TRACED SHADOW (`rayTracedShadow`, a thread a pixel of the window, for the light of the run): for each lit pixel the light reaches (`lightReaches`: its range, a spot's cone,
 * a rectangle's face), `samples` rays are cast from the pixel through the scene's triangles (`sceneTraceWgsl.ts`) to a point drawn on the light, and the pixel's visibility is the
 * share of them that arrive.
 *
 * THE SAMPLE: from the pixel's own two numbers of the sequence (`ptRandCreateDiffused`: the pixel, the image, the sample's index and the number of them) — a sun's direction drawn in the
 * cone of its disk; a lamp's in the cone its sphere subtends (concentric map), or on the sphere itself when the pixel is inside it, the ray ending where it meets the sphere; a
 * tube's over the smaller of the rectangle and the cone that bound its capsule (`sampleCapsule`, the tube sampling every trace shares), a sample that misses the tube given up; a
 * rectangle's by the solid angle it covers (`sampleSphericalRect`), the sample on the back of the face given up. A sample given up shadows nothing and lights nothing: it is counted neither as seen nor as blocked, so the visibility is the share of the rays cast that arrived, whole where none was blocked.
 *
 * THE PIXEL: traced only where it is lit (`rtLit`), in a lighting channel of the light (`lightChannelsOf`, `channelsOfFlags`) and reached by the light. The faces that turn from the sample are
 * skipped, but for a rectangle's and for the surfaces light goes through: an eye, a thin two-sided sheet (foliage) and a subsurface-model pixel. A hair pixel is faced toward the light.
 *
 * THE START: moved toward the eye by the larger of a ten-thousandth of the distance to it and the normal bias, then off the surface along the normal by that bias at grazing
 * angles and by the least bias facing the ray (`params.bias`, in metres). A sample that points under the surface, but for a rectangle's, is given up; so is one ending past the lamp's range.
 *
 * THE RAY: its first part, the length of `params.bias.y`, is cast with the back faces culled — a hit there is the surface the pixel is on or a thin one against it —, then the rest from
 * where that ended; a ray ends at the first primitive it meets (`params.flags.z`) and casts from both faces of the geometry (`params.flags.y`). The translucent primitives and the
 * placements that cast no shadow are passed. A pixel of a first-person object does not meet the world's stand-ins of the first-person objects. A trace that stopped before its walk was
 * whole shadows the sample.
 *
 * THE THICKNESS: where a ray of a subsurface-model or hair pixel is blocked, a ray goes back from the light's end (a sun's `params.lod.z` away) to the pixel; if it meets a surface, the light that gets
 * through is the exponential of the thickness (in centimetres) times the density the pixel's opacity gives (a hair's is one): a light that gets through whole counts as seen. Past `params.lod.x`
 * from the eye the pixel's visibility goes over to the light that gets through, at `params.lod.y` it is only that.
 *
 * THE ANSWER: the visibility, a sun's taken into its layer (`params.sizes.w` and up) of the mask by the minimum, a local light's written in the run's layer for every pixel of the window; with the denoiser
 * (`params.flags.w`) every light's is written in its layer of the run's texture as it is (not taken by the minimum), and the distance of the nearest blocker is written beside it (`hits`: the least distance of the rays that were blocked,
 * `RT_MISS` where every ray arrived, `RT_INVALID` where nothing was traced). The light is a record, its rank in the light buffer and the rays a pixel casts to it.
 */
const PARAMS_WGSL = wgslBlock(
  'RAY_TRACED_PARAMS_WGSL',
  [],
  `struct RayTracedParams{
 sizes:vec4u,
 window:vec4u,
 bias:vec4f,
 flags:vec4u,
 light:vec4f,
 lod:vec4f,
}
@group(0) @binding(${B.params}) var<uniform> params:RayTracedParams;
@group(0) @binding(${B.normals}) var normals:texture_2d<f32>;
@group(0) @binding(${B.flags}) var flags:texture_2d<u32>;
@group(0) @binding(${B.mask}) var shadowMask:texture_storage_2d_array<r32float,read_write>;
@group(0) @binding(${B.lights}) var<storage,read> directLights:DirectLights;
@group(0) @binding(${B.hits}) var hitDistances:texture_storage_2d_array<r32float,write>;
@group(0) @binding(${B.subsurface}) var subsurfaceColor:texture_2d<f32>;`,
)

export const RAY_WGSL = wgslBlock(
  'RAY_TRACED_RAY_WGSL',
  [
    sampleCone,
    sampleSphereEven,
    buildSphericalRect,
    sampleSphericalRect,
    lightTraits,
    LIGHT_CAPSULE_WGSL,
  ],
  `struct RtRay{direction:vec3f,reach:f32,valid:bool,}
fn rtLamp(light:DirectLight,P:vec3f,e:vec2f)->RtRay{
 let toLight=light.positionRange.xyz-P;
 let radius=light.shape.x;
 let distance2=dot(toLight,toLight);
 if(distance2<=radius*radius){
  let onSphere=light.positionRange.xyz+sampleSphereEven(e)*radius;
  let toPoint=onSphere-P;
  let reach=max(length(toPoint),1e-6);
  return RtRay(toPoint/reach,reach,true);
 }
 let away=sqrt(distance2);
 let sin2=radius*radius/distance2;
 let sampled=sampleCone(e,sin2,toLight*(1.0/(away+1e-4)),true);
 let cosTheta=dot(sampled.xyz,toLight/away);
 return RtRay(sampled.xyz,away*(cosTheta-sqrt(max(sin2-(1.0-cosTheta*cosTheta),0.0))),true);
}
fn rtTube(light:DirectLight,P:vec3f,e:vec2f)->RtRay{
 let sampled=sampleCapsule(light.positionRange.xyz-P,emitterAxisOf(light),light.shape.x,2.0*tubeHalfLengthOf(light),e);
 return RtRay(sampled.xyz,sampled.w,sampled.w>0.0);
}
fn rtRect(light:DirectLight,P:vec3f,e:vec2f)->RtRay{
 let across=light.shape.xyz;
 let sides=vec2f(length(across),light.shape.w);
 let axis=light.directionCone.xyz;
 let along=across/max(sides.x,1e-12);
 let rect=buildSphericalRect(light.positionRange.xyz-P,along,normalize(cross(along,axis)),-axis,sides);
 let sampled=sampleSphericalRect(e,rect);
 return RtRay(sampled.direction,sampled.distance,dot(sampled.direction,axis)<=0.0);
}
fn rtSun(light:DirectLight,e:vec2f)->RtRay{
 let sampled=sampleCone(e,light.traits.z*light.traits.z,-light.directionCone.xyz,false);
 return RtRay(sampled.xyz,${RAY_TRACED_SUN_REACH},true);
}
fn rtSample(light:DirectLight,P:vec3f,e:vec2f)->RtRay{
 if(isSun(light)){return rtSun(light,e);}
 if(isRect(light)){return rtRect(light,P,e);}
 if(tubeHalfLengthOf(light)>0.0){return rtTube(light,P,e);}
 return rtLamp(light,P,e);
}`,
)

const TRACE_WGSL = `
/** What a pixel's rays found for a light: the share that arrived and the distance of the nearest blocker ('RT_MISS' when none blocked, 'RT_INVALID' when no ray was cast). */
const RT_INVALID:f32=${SHADOW_HIT_INVALID}.0;
const RT_MISS:f32=${SHADOW_HIT_MISS}.0;
struct RtOcclusion{visibility:f32,closest:f32,}
/** The start of a ray from the surface point P of normal N along D, in metres: toward the eye, then off the surface. */
fn rtOrigin(P:vec3f,N:vec3f,D:vec3f)->vec3f{
 let bias=max(viewEyeDistance(P)*1.0e-4,params.bias.x);
 let toEye=P+viewToEye(P)*bias;
 return toEye+N*mix(max(params.bias.z,bias),params.bias.z,saturate(dot(N,D)));
}
/** Whether the ray is stopped before it has gone reach: by a hit, or by a trace that did not finish; the distance it was stopped at and where the second part of it began. */
struct RtBlock{blocked:bool,distance:f32,restart:f32,}
fn rtBlocked(origin:vec3f,D:vec3f,reach:f32,rayFlags:u32)->RtBlock{
 let avoid=min(params.bias.y,reach);
 if(avoid>0.0){
  let nearHit=stTrace(StRay(origin-view.display.yzw,D,0.0,avoid,rayFlags|ST_CULL_BACK));
  if(nearHit.hit){return RtBlock(true,nearHit.distance,0.0);}
  if(!stComplete){return RtBlock(true,avoid,0.0);}
 }
 let farHit=stTrace(StRay(origin-view.display.yzw,D,avoid,reach,rayFlags));
 return RtBlock(farHit.hit||!stComplete,select(avoid,farHit.distance,farHit.hit),avoid);
}
fn rtLit(word:u32)->bool{
 let model=word&${SURFACE_MODEL_MASK}u;
 return model==${MODEL_FLAG.physical}u||model==${MODEL_FLAG.diffuse}u||model==${MODEL_FLAG.shadow}u;
}
/** The light that gets through a subsurface-model or hair pixel at P whose ray along D was blocked: a ray goes back from the light's end (a sun's is 'params.lod.z' away) to the pixel; the
 *  exponential of the thickness it meets, in centimetres, times the density (the opacity's: minus a twentieth of the logarithm of what the opacity leaves; a hair's is one). 0 where nothing is met. */
fn rtTransmission(origin:vec3f,P:vec3f,D:vec3f,reach:f32,sun:bool,opacity:f32,hair:bool,restart:f32,rayFlags:u32)->f32{
 let span=select(reach,min(reach,params.lod.z),sun);
 let back=origin+D*span;
 // The part of the ray the first cast skipped is at the pixel's end, which is the end of this one.
 let hit=stTrace(StRay(back-view.display.yzw,-D,0.0,max(span-restart,0.0),rayFlags&~ST_ANY_HIT));
 if(!hit.hit){return 0.0;}
 let thickness=distance(back-D*hit.distance,P)*100.0;
 let density=select(-0.05*log(1.0-min(opacity,0.999)),1.0,hair);
 return saturate(exp(-density*thickness));
}
/** Whether a pixel's back faces are not culled: the surfaces light goes through, an eye, a thin two-sided sheet and a subsurface-model pixel. */
fn rtThroughSurface(word:u32)->bool{
 let model=pixelModelOf(word);
 return (word&${SUBSURFACE_FLAG}u)!=0u||model==${PIXEL_MODEL.eye}u||model==${PIXEL_MODEL.subsurface}u;
}
/** What samples rays from P cast to light rank found. */
fn rtOcclusion(rank:u32,P:vec3f,N:vec3f,pixel:vec2u,samples:u32,word:u32)->RtOcclusion{
 let light=directLights.items[rank];
 let sun=isSun(light);
 let local=!sun;
 let model=pixelModelOf(word);
 let hair=model==${PIXEL_MODEL.hair}u;
 let wrapped=hair||model==${PIXEL_MODEL.subsurface}u;
 let through=rtThroughSurface(word);
 var faced=N;
 if(hair){faced=select(normalize(light.positionRange.xyz-P),-light.directionCone.xyz,sun);}
 var rayFlags=ST_SHADOW|ST_SKIP_TRANSLUCENT;
 if(params.flags.z!=0u){rayFlags|=ST_ANY_HIT;}
 if(params.flags.y==0u){rayFlags|=ST_CULL_BACK;}
 if(!isFirstPerson(word)){rayFlags|=ST_MEET_WORLD_SPACE;}
 let range=light.positionRange.w;
 let opacity=select(0.0,min(textureLoad(subsurfaceColor,vec2i(pixel),0).a,0.99),wrapped);
 var visibility=0.0;
 var transmitted=0.0;
 var nearest=3.0e38;
 var rays=0.0;
 var blockedRays=0.0;
 for(var s=0u;s<samples;s++){
  var rng=ptRandCreateDiffused(pixel,params.flags.x,s,samples);
  let ray=rtSample(light,P,ptRand2(&rng));
  let faces=isRect(light)||through||dot(faced,ray.direction)>0.0;
  if(!ray.valid||!faces||(local&&ray.reach>range)){continue;}
  let origin=rtOrigin(P,faced,ray.direction);
  let block=rtBlocked(origin,ray.direction,ray.reach,rayFlags);
  rays+=1.0;
  if(!block.blocked){
   visibility+=1.0;
   transmitted+=1.0;
   continue;
  }
  nearest=min(nearest,block.distance);
  blockedRays+=1.0;
  if(wrapped){
   let passed=rtTransmission(origin,P,ray.direction,ray.reach,sun,opacity,hair,block.restart,rayFlags);
   if(passed==1.0){visibility+=1.0;}
   transmitted+=passed;
  }
 }
 if(wrapped){
  let fade=params.lod.y-params.lod.x;
  let depth=viewEyeDistance(P);
  if(depth>params.lod.x){visibility=mix(visibility,transmitted,select(1.0,saturate((depth-params.lod.x)/fade),fade>0.0));}
 }
 var closest=RT_INVALID;
 if(blockedRays>0.0){closest=nearest;}
 else if(rays>0.0){closest=RT_MISS;}
 // A pixel whose every sample was given up is unshadowed, as the denoiser's output has it.
 return RtOcclusion(select(visibility/max(rays,1.0),1.0,rays==0.0),closest);
}
@compute @workgroup_size(${RAY_TRACED_GROUP},${RAY_TRACED_GROUP},1)
fn ${RAY_TRACED_ENTRY}(@builtin(global_invocation_id) gid:vec3u){
 let pixel=gid.xy+params.window.xy;
 if(any(pixel>=params.window.zw)){return;}
 let record=params.light;
 let rank=u32(record.x);
 let denoised=params.flags.w!=0u;
 // A rank past the buffer names no light: the pixel is written as lit and its distance as unknown, so no layer keeps the last image's.
 let named=rank<directLights.count;
 let light=directLights.items[select(0u,rank,named)];
 let local=named&&!isSun(light);
 var found=RtOcclusion(1.0,RT_INVALID);
 let z=hizOpaqueDepth(vec2i(pixel));
 let word=textureLoad(flags,vec2i(pixel),0).r;
 if(named&&z!=0.0&&rtLit(word)&&(lightChannelsOf(light)&channelsOfFlags(word))!=0u){
  let P=worldAt(vec2f(pixel)+vec2f(0.5),z);
  if(lightReaches(rank,P)){
   let N=normalize(textureLoad(normals,vec2i(pixel),0).xyz);
   found=rtOcclusion(rank,P,N,pixel,max(u32(record.y),1u),word);
  }
 }
 let slot=i32(params.sizes.w);
 if(denoised){textureStore(hitDistances,pixel,slot,vec4f(found.closest,0.0,0.0,0.0));}
 if(local||denoised){textureStore(shadowMask,pixel,slot,vec4f(found.visibility,0.0,0.0,0.0));return;}
 if(found.visibility<1.0){
  let held=textureLoad(shadowMask,pixel,slot).x;
  textureStore(shadowMask,pixel,slot,vec4f(min(held,found.visibility),0.0,0.0,0.0));
 }
}`

/** The program of the kernel: its own textures in group 0, the reflection group (the view and the depth pyramid) and the scene trace's group, whose rays cut the surfaces by the graph masks `programs`. */
export const rayTracedProgram = (programs: SceneMaskPrograms = NO_SCENE_MASKS) =>
  wgslProgram(TRACE_WGSL, [
    PARAMS_WGSL,
    DIRECT_LIGHT_WGSL,
    WORLD_AT_WGSL,
    isFirstPerson,
    pixelModelOf,
    lightChannelsOf,
    channelsOfFlags,
    PT_RANDOM_WGSL,
    RAY_WGSL,
    REFLECTION_CONSTANTS_WGSL,
    reflectionBindingsWgsl(REFLECTION_GROUP),
    reflectionLightViewWgsl(REFLECTION_GROUP),
    sceneTraceWgsl(RAY_TRACED_SCENE.group, RAY_TRACED_SCENE.first),
    sceneMaskWgsl(RAY_TRACED_SCENE.group, RAY_TRACED_SCENE.first, programs),
  ])

export const RAY_TRACED_MERGE_ENTRY = 'rayTracedMerge'

/** The merge of a local light's layer into the light's mask (a fragment program over the full-screen triangle): the square root of the visibility, which the pipeline's blend takes the minimum of with the mask. */
export const rayTracedMergeProgram = () =>
  wgslProgram(
    `@group(0) @binding(0) var shadowLayer:texture_2d<f32>;
@fragment fn ${RAY_TRACED_MERGE_ENTRY}(@builtin(position) at:vec4f)->@location(0) vec4f{
 return vec4f(sqrt(textureLoad(shadowLayer,vec2i(at.xy),0).x));
}`,
    [FULLSCREEN_VERTEX],
  )
