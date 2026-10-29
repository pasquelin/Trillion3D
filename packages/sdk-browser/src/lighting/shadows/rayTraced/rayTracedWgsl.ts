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
import { DIRECT_LIGHT_WGSL } from '../../direct/lightWgsl.ts'
import { WORLD_AT_WGSL } from '../../deferred/worldAtWgsl.ts'
import { PT_RANDOM_WGSL } from '../../pathTracing/randomWgsl.ts'
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
export const RAY_TRACED_BINDINGS = { params: 0, normals: 2, flags: 3, mask: 4, lights: 5 } as const
const B = RAY_TRACED_BINDINGS

export const RAY_TRACED_ENTRY = 'rayTracedShadow'

/** The reach of a sun's ray: the sun has no end to be stopped at. */
const SUN_REACH = '1.0e27'

/**
 * THE RAY TRACED SHADOW (`rayTracedShadow`, a thread a pixel of the window, for the light of the run): for each lit pixel the light reaches (`lightReaches`: its range, a spot's cone,
 * a rectangle's face), `samples` rays are cast from the pixel through the scene's triangles (`sceneTraceWgsl.ts`) to a point drawn on the light, and the pixel's visibility is the
 * share of them that arrive.
 *
 * THE SAMPLE: from the pixel's own two numbers of the sequence (`ptRandCreateDiffused`: the pixel, the image, the sample's index and the number of them) — a sun's direction drawn in the
 * cone of its disk; a lamp's in the cone its sphere subtends (concentric map), or on the sphere itself when the pixel is inside it, the ray ending where it meets the sphere; a
 * rectangle's by the solid angle it covers (`sampleSphericalRect`), the sample on the back of the face given up. A lamp's tube is sampled as the sphere about its centre.
 *
 * THE START: moved toward the eye by the larger of a ten-thousandth of the distance to it and the normal bias, then off the surface along the normal by that bias at grazing
 * angles and by the least bias facing the ray (`params.bias`, in metres). A sample that points under the surface, but for a rectangle's, is shadowed; so is one ending past the lamp's range.
 *
 * THE RAY: its first part, the length of `params.bias.y`, is cast with the back faces culled — a hit there is the surface the pixel is on or a thin one against it —, then the rest from
 * where that ended; a ray ends at the first primitive it meets (`params.flags.z`) and casts from both faces of the geometry (`params.flags.y`). The translucent primitives and the
 * placements that cast no shadow are passed. A pixel of a first-person object does not meet the world's stand-ins of the first-person objects. A trace that stopped before its walk was
 * whole shadows the sample.
 *
 * THE ANSWER: the visibility, a sun's taken into its layer (`params.sizes.w` and up) of the mask by the minimum, a local light's written in the run's layer for every pixel of the window. The light is a record, its rank in the light buffer and the rays a pixel casts to it.
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
}
@group(0) @binding(${B.params}) var<uniform> params:RayTracedParams;
@group(0) @binding(${B.normals}) var normals:texture_2d<f32>;
@group(0) @binding(${B.flags}) var flags:texture_2d<u32>;
@group(0) @binding(${B.mask}) var shadowMask:texture_storage_2d_array<r32float,read_write>;
@group(0) @binding(${B.lights}) var<storage,read> directLights:DirectLights;`,
)

const RAY_WGSL = wgslBlock(
  'RAY_TRACED_RAY_WGSL',
  [sampleCone, sampleSphereEven, buildSphericalRect, sampleSphericalRect],
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
 return RtRay(sampled.xyz,${SUN_REACH},true);
}
fn rtSample(light:DirectLight,P:vec3f,e:vec2f)->RtRay{
 if(isSun(light)){return rtSun(light,e);}
 if(isRect(light)){return rtRect(light,P,e);}
 return rtLamp(light,P,e);
}`,
)

const TRACE_WGSL = `
/** The start of a ray from the surface point P of normal N along D, in metres: toward the eye, then off the surface. */
fn rtOrigin(P:vec3f,N:vec3f,D:vec3f)->vec3f{
 let bias=max(viewEyeDistance(P)*1.0e-4,params.bias.x);
 let toEye=P+viewToEye(P)*bias;
 return toEye+N*mix(max(params.bias.z,bias),params.bias.z,saturate(dot(N,D)));
}
/** Whether the ray is stopped before it has gone reach: by a hit, or by a trace that did not finish. */
fn rtBlocked(origin:vec3f,D:vec3f,reach:f32,rayFlags:u32)->bool{
 let avoid=min(params.bias.y,reach);
 if(avoid>0.0){
  let nearHit=stTrace(StRay(origin-view.display.yzw,D,0.0,avoid,rayFlags|ST_CULL_BACK));
  if(nearHit.hit||!stComplete){return true;}
 }
 let farHit=stTrace(StRay(origin-view.display.yzw,D,avoid,reach,rayFlags));
 return farHit.hit||!stComplete;
}
fn rtLit(word:u32)->bool{
 let model=word&${SURFACE_MODEL_MASK}u;
 return model==${MODEL_FLAG.physical}u||model==${MODEL_FLAG.diffuse}u||model==${MODEL_FLAG.toon}u||model==${MODEL_FLAG.shadow}u;
}
/** The share of samples rays from P that arrive at light rank. */
fn rtVisibility(rank:u32,P:vec3f,N:vec3f,pixel:vec2u,samples:u32,firstPerson:bool)->f32{
 let light=directLights.items[rank];
 let local=!isSun(light);
 var rayFlags=ST_SHADOW|ST_SKIP_TRANSLUCENT;
 if(params.flags.z!=0u){rayFlags|=ST_ANY_HIT;}
 if(params.flags.y==0u){rayFlags|=ST_CULL_BACK;}
 if(!firstPerson){rayFlags|=ST_MEET_WORLD_SPACE;}
 let range=light.positionRange.w;
 var arrived=0.0;
 for(var s=0u;s<samples;s++){
  var rng=ptRandCreateDiffused(pixel,params.flags.x,s,samples);
  let ray=rtSample(light,P,ptRand2(&rng));
  let faces=isRect(light)||dot(N,ray.direction)>0.0;
  if(!ray.valid||!faces||(local&&ray.reach>range)){continue;}
  if(!rtBlocked(rtOrigin(P,N,ray.direction),ray.direction,ray.reach,rayFlags)){arrived+=1.0;}
 }
 return arrived/f32(samples);
}
@compute @workgroup_size(${RAY_TRACED_GROUP},${RAY_TRACED_GROUP},1)
fn ${RAY_TRACED_ENTRY}(@builtin(global_invocation_id) gid:vec3u){
 let pixel=gid.xy+params.window.xy;
 if(any(pixel>=params.window.zw)){return;}
 let record=params.light;
 let rank=u32(record.x);
 if(rank>=directLights.count){return;}
 let local=!isSun(directLights.items[rank]);
 var visibility=1.0;
 let z=hizOpaqueDepth(vec2i(pixel));
 let word=textureLoad(flags,vec2i(pixel),0).r;
 if(z!=0.0&&rtLit(word)){
  let P=worldAt(vec2f(pixel)+vec2f(0.5),z);
  if(lightReaches(rank,P)){
   let N=normalize(textureLoad(normals,vec2i(pixel),0).xyz);
   visibility=rtVisibility(rank,P,N,pixel,max(u32(record.y),1u),isFirstPerson(word));
  }
 }
 let slot=i32(params.sizes.w);
 if(local){textureStore(shadowMask,pixel,slot,vec4f(visibility,0.0,0.0,0.0));return;}
 if(visibility<1.0){
  let held=textureLoad(shadowMask,pixel,slot).x;
  textureStore(shadowMask,pixel,slot,vec4f(min(held,visibility),0.0,0.0,0.0));
 }
}`

/** The program of the kernel: its own textures in group 0, the reflection group (the view and the depth pyramid) and the scene trace's group. */
export const rayTracedProgram = () =>
  wgslProgram(TRACE_WGSL, [
    PARAMS_WGSL,
    DIRECT_LIGHT_WGSL,
    WORLD_AT_WGSL,
    isFirstPerson,
    PT_RANDOM_WGSL,
    RAY_WGSL,
    REFLECTION_CONSTANTS_WGSL,
    reflectionBindingsWgsl(REFLECTION_GROUP),
    reflectionLightViewWgsl(REFLECTION_GROUP),
    sceneTraceWgsl(RAY_TRACED_SCENE.group, RAY_TRACED_SCENE.first),
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
