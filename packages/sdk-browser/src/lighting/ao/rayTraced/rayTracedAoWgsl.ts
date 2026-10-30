import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { PI } from '../../../../../math/src/wgsl/constants.ts'
import { frameAround, outOfFrame } from '../../../../../math/src/wgsl/basis.ts'
import { uniformDiskConcentric } from '../../../../../math/src/wgsl/sampling.ts'
import { UNLIT_FLAG, SURFACE_MODEL_MASK } from '../../../materials/surface/surfaceModelWord.ts'
import { isFirstPerson } from '../../../materials/surface/surfaceModel.ts'
import { SUBSURFACE_FLAG } from '../../../materials/surface/subsurface.ts'
import { WORLD_AT_WGSL } from '../../deferred/worldAtWgsl.ts'
import { RAY_ORIGIN_WGSL } from '../../rays/rayOriginWgsl.ts'
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
export const RAY_TRACED_AO_GROUP = 8
/** The scene trace's group and its first binding in it (the reflection group is the one before). */
export const RAY_TRACED_AO_SCENE = { group: 2, first: 0 } as const

/** The bindings of group 0. The cut's tables the scene trace walks are at the culling's bindings of that group (1, 6, 7 and 9): none of these is. */
export const RAY_TRACED_AO_BINDINGS = { params: 0, normals: 2, flags: 3, occlusion: 4 } as const
const B = RAY_TRACED_AO_BINDINGS

/** The format of the occlusion the kernel writes: a storage texture the lighting (and the strands' occlusion) read as they read the search's, so one a filtering layout takes. */
export const RAY_TRACED_AO_FORMAT: GPUTextureFormat = 'rgba16float'

export const RAY_TRACED_AO_ENTRY = 'rayTracedAmbientOcclusion'

/** The least weight of a ray, and of the cosine its weight is divided by: a ray at a grazing angle counts for this much at least. */
const LEAST_WEIGHT = '0.05'

/** The least offset of a ray's start off the surface, in metres. */
const LEAST_BIAS = '0.0001'

/** The distance a pixel stores, in the occlusion's green, for the denoiser: where its rays cast none, a negative one (no sample); where none of its rays hit, 100 metres (the reference's ten thousand centimetres). */
const RAY_TRACED_AO_NO_SAMPLE = '-2.0'
const RAY_TRACED_AO_NO_HIT = '100.0'

/** The sharpness and the amplitude of the spherical Gaussian that stands for a clamped cosine lobe. */
const COSINE_SHARPNESS = '2.133'
const COSINE_AMPLITUDE = '1.17'

const PARAMS_WGSL = wgslBlock(
  'RAY_TRACED_AO_PARAMS_WGSL',
  [],
  `struct RayTracedAoParams{
 sizes:vec4u,
 window:vec4u,
 trace:vec4f,
 flags:vec4u,
}
@group(0) @binding(${B.params}) var<uniform> params:RayTracedAoParams;
@group(0) @binding(${B.normals}) var normals:texture_2d<f32>;
@group(0) @binding(${B.flags}) var flags:texture_2d<u32>;
@group(0) @binding(${B.occlusion}) var occlusion:texture_storage_2d<${RAY_TRACED_AO_FORMAT},write>;`,
)

/**
 * THE RAY-TRACED AMBIENT OCCLUSION (`rayTracedAmbientOcclusion`, a thread a pixel of the window): for each pixel of a lit surface, `params.sizes.z` rays are cast over the hemisphere
 * of its geometric normal through the scene's triangles (`sceneTraceWgsl.ts`), each as far as `params.trace.x` metres; the pixel's occlusion is the weighted share of them that arrive.
 *
 * THE GEOMETRIC NORMAL: where the pixel is not a thin two-sided sheet (foliage), it is found from the depth round the pixel: the vectors to the four neighbours (clamped to the window), the
 * shorter of the two across and of the two down, their cross product, turned toward the eye. Where a neighbour lies in front of the pixel by more than five of its pixels' radii on both
 * axes (a silhouette) the shading normal is taken instead. Else the shading normal is the geometric one. `shadingDotGeometric` is how much the two lobes overlap (the clamped-cosine lobes as
 * spherical Gaussians, the shading lobe against the geometric one over the lobe against itself), a factor on the pixel's occlusion.
 *
 * THE RAY: a direction of the cosine lobe about the geometric normal (concentric map; its density is the cosine itself), the pixel's own two numbers of the sequence for each sample
 * (`ptRandCreateDiffused`). It starts where the pixel is (`rayOrigin`: toward the eye by the larger of a ten-thousandth of the distance to it and the normal bias `params.trace.z`, in metres, then off the
 * surface along the shading normal). It ends at the nearest primitive (`params.flags.y` casts from both faces, `params.flags.z`
 * lets the masks of the masked surfaces cut). The translucent primitives and the placements that cast no shadow are passed. A trace that stopped before its walk was whole blocks the ray.
 *
 * THE WEIGHT of a ray is the shading normal's cosine to it over the cosine to the geometric normal, each held to at least 0.05; a ray that arrives adds its weight, a ray that is blocked adds its weight
 * times what `params.trace.y` (the intensity) leaves of it. A pixel that is not traced (no surface, an unlit one, no ray asked) is unoccluded.
 * The kernel writes the occlusion in the red and, in the green, the distance of the nearest primitive any ray hit (`RAY_TRACED_AO_NO_HIT` where none did), which the denoiser reads.
 */
const TRACE_WGSL = `
struct RtAoGeometry{normal:vec3f,overlap:f32,}
fn aoDepthAt(pixel:vec2i)->f32{
 let low=vec2i(params.window.xy);
 let high=vec2i(params.window.zw)-vec2i(1);
 return hizOpaqueDepth(clamp(pixel,low,high));
}
/** The point of the neighbour at the offset: the window's own pixel where the offset leaves it, so that its depth and its place agree. */
fn aoNeighbour(pixel:vec2i,offset:vec2i)->vec3f{
 let low=vec2i(params.window.xy);
 let high=vec2i(params.window.zw)-vec2i(1);
 let at=clamp(pixel+offset,low,high);
 return worldAt(vec2f(at)+vec2f(0.5),hizOpaqueDepth(at));
}
/** The spherical-Gaussian overlap of two clamped-cosine lobes: their integral product. */
fn aoLobeOverlap(a:vec3f,b:vec3f)->f32{
 let total=2.0*${COSINE_SHARPNESS};
 let mean=${COSINE_SHARPNESS}*(a+b);
 let reach=length(mean);
 return 2.0*PI*${COSINE_AMPLITUDE}*${COSINE_AMPLITUDE}*exp(reach-total)*(1.0-exp(-2.0*reach))/reach;
}
/** The geometric normal of the pixel at P, of shading normal N, and the overlap factor; the pixel's radius in the world is 'radius' (half a pixel). */
fn aoGeometry(pixel:vec2i,P:vec3f,N:vec3f,thin:bool,radius:f32)->RtAoGeometry{
 if(thin){return RtAoGeometry(N,1.0);}
 let east=aoNeighbour(pixel,vec2i(1,0))-P;
 let west=aoNeighbour(pixel,vec2i(-1,0))-P;
 let north=aoNeighbour(pixel,vec2i(0,-1))-P;
 let south=aoNeighbour(pixel,vec2i(0,1))-P;
 let forward=view.contact.xyz;
 let across=dot(east,forward)+dot(west,forward);
 let down=dot(north,forward)+dot(south,forward);
 let h=select(west,east,dot(east,east)<dot(west,west));
 let v=select(north,south,dot(south,south)<dot(north,north));
 var geometric=normalize(cross(h,v));
 if(dot(geometric,viewToEye(P))<0.0){geometric=-geometric;}
 let straight=aoLobeOverlap(vec3f(0.0,0.0,1.0),vec3f(0.0,0.0,1.0));
 let overlap=saturate(aoLobeOverlap(N,geometric)/straight);
 if(across<-5.0*radius||down<-5.0*radius){return RtAoGeometry(N,1.0);}
 return RtAoGeometry(geometric,overlap);
}
fn aoVisible(word:u32)->bool{return (word&${SURFACE_MODEL_MASK}u)!=${UNLIT_FLAG}u;}
@compute @workgroup_size(${RAY_TRACED_AO_GROUP},${RAY_TRACED_AO_GROUP},1)
fn ${RAY_TRACED_AO_ENTRY}(@builtin(global_invocation_id) gid:vec3u){
 let pixel=gid.xy+params.window.xy;
 if(any(pixel>=params.window.zw)){return;}
 let at=vec2i(pixel);
 let z=hizOpaqueDepth(at);
 let word=textureLoad(flags,at,0).r;
 let samples=select(0u,params.sizes.z,z!=0.0&&aoVisible(word));
 var result=1.0;
 var closest=${RAY_TRACED_AO_NO_HIT};
 if(samples>0u){
  let P=worldAt(vec2f(pixel)+vec2f(0.5),z);
  let N=normalize(textureLoad(normals,at,0).xyz);
  let thin=(word&${SUBSURFACE_FLAG}u)!=0u;
  let depth=select(dot(P-view.camera.xyz,view.contact.xyz),1.0,view.camera.w==0.0);
  let geometry=aoGeometry(at,P,N,thin,params.trace.w*depth);
  var rayFlags=ST_SHADOW|ST_SKIP_TRANSLUCENT;
  if(params.flags.y==0u){rayFlags|=ST_CULL_BACK;}
  if(params.flags.z==0u){rayFlags|=ST_FORCE_OPAQUE;}
  if(!isFirstPerson(word)){rayFlags|=ST_MEET_WORLD_SPACE;}
  var seen=0.0;
  var count=0.0;
  for(var s=0u;s<samples;s++){
   var rng=ptRandCreateDiffused(pixel,params.sizes.w,s,samples);
   let disk=uniformDiskConcentric(ptRand2(&rng));
   let cosine=sqrt(max(1.0-dot(disk,disk),0.0));
   let direction=outOfFrame(vec3f(disk,cosine),frameAround(geometry.normal));
   let origin=rayOrigin(P,N,direction,params.trace.z,${LEAST_BIAS});
   let weight=max(dot(N,direction),${LEAST_WEIGHT})/max(cosine,${LEAST_WEIGHT});
   let hit=stTrace(StRay(origin-view.display.yzw,direction,0.0,params.trace.x,rayFlags));
   count+=weight;
   let blocked=hit.hit||!stComplete;
   seen+=weight*select(1.0,1.0-params.trace.y,blocked);
   if(blocked){closest=min(closest,min(hit.distance,stReached));}
  }
  result=geometry.overlap*seen/count;
 }
 textureStore(occlusion,at,vec4f(result,select(${RAY_TRACED_AO_NO_SAMPLE},closest,samples>0u),0.0,0.0));
}`

/** The program of the kernel: its own textures in group 0, the reflection group (the view and the depth pyramid) and the scene trace's group, whose rays cut the surfaces by the graph masks `programs`. */
export const rayTracedAoProgram = (programs: SceneMaskPrograms = NO_SCENE_MASKS) =>
  wgslProgram(TRACE_WGSL, [
    PARAMS_WGSL,
    WORLD_AT_WGSL,
    RAY_ORIGIN_WGSL,
    PI,
    isFirstPerson,
    PT_RANDOM_WGSL,
    uniformDiskConcentric,
    frameAround,
    outOfFrame,
    REFLECTION_CONSTANTS_WGSL,
    reflectionBindingsWgsl(REFLECTION_GROUP),
    reflectionLightViewWgsl(REFLECTION_GROUP),
    sceneTraceWgsl(RAY_TRACED_AO_SCENE.group, RAY_TRACED_AO_SCENE.first, true),
    sceneMaskWgsl(RAY_TRACED_AO_SCENE.group, RAY_TRACED_AO_SCENE.first, programs),
  ])
