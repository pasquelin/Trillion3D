import { wgslBlock, wgslVariants } from '../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { PI } from '../../../../math/src/wgsl/constants.ts'
import { frameAround, outOfFrame } from '../../../../math/src/wgsl/basis.ts'
import {
  rand3dPcg16,
  sampleSphereEven,
  uniformDiskConcentric,
} from '../../../../math/src/wgsl/sampling.ts'
import { voxelNamesOf, voxelParamsWgsl } from '../../hair/voxelWgsl.ts'
import { voxelTraversalWgsl } from '../../hair/voxelTraversalWgsl.ts'
import { UNLIT_FLAG, SURFACE_MODEL_MASK } from '../../materials/surface/surfaceModelWord.ts'
import { isFirstPerson } from '../../materials/surface/surfaceModel.ts'
import { WORLD_AT_WGSL } from '../deferred/worldAtWgsl.ts'
import { PT_RANDOM_WGSL } from '../pathTracing/randomWgsl.ts'
import { PT_SKY_WGSL } from '../pathTracing/skyWgsl.ts'
import { RAY_ORIGIN_WGSL } from '../rays/rayOriginWgsl.ts'
import { NO_SCENE_MASKS, type SceneMaskPrograms } from '../rays/sceneTrace/sceneMaskPrograms.ts'
import { sceneMaskWgsl } from '../rays/sceneTrace/sceneMaskWgsl.ts'
import { sceneTraceWgsl } from '../rays/sceneTrace/sceneTraceWgsl.ts'
import { SKY_ALBEDO_WGSL, SKY_MODEL_WGSL } from './skyLightTracedModelWgsl.ts'
import { REFLECTION_CONSTANTS_WGSL } from '../reflections/constantsWgsl.ts'
import {
  REFLECTION_GROUP,
  reflectionBindingsWgsl,
  reflectionLightViewWgsl,
} from '../reflections/viewLayout.ts'

/** The side of a workgroup of the trace, in threads, and of the pass that draws the rays' directions. */
export const SKY_TRACE_GROUP = 8
export const SKY_RAYS_GROUP = 16
/** The side, in pixels, of the table of directions the decoupled pass draws and the trace repeats over the image. */
export const SKY_RAYS_SIDE = 256
/** The scene trace's group and its first binding in it (the reflection group is the one before). */
export const SKY_TRACE_SCENE = { group: 2, first: 0 } as const

/** The bindings of the trace's group 0. The cut's tables the scene trace walks are at the culling's bindings of that group (1, 6, 7 and 9): none of these is. */
export const SKY_TRACE_BINDINGS = {
  params: 0,
  normals: 2,
  flags: 3,
  light: 4,
  open: 5,
  rays: 8,
  skyTexture: 10,
  skyPdf: 11,
} as const
/**
 * The strands' voxels the trace marches through where the view has them (`rayTracedSkyLightHairVoxel`), in a group of their own after the scene trace's: the volume's parameters, the macro groups'
 * nodes, the page index and the voxels. They are read under names led by `sky` (`voxelNamesOf`), the cut's tables of group 0 being named `nodes` already.
 */
export const SKY_TRACE_HAIR = { group: 3, params: 0, nodes: 1, pageIndex: 2, voxels: 3 } as const
/** The storage buffers a stage of the trace binds with the strands' voxels: the six it binds without them and the voxels' three. */
export const SKY_TRACE_STORAGE_WITH_HAIR = 9
/** The bindings of the pass that draws the rays' directions. */
export const SKY_RAYS_BINDINGS = { params: 0, rays: 1, skyTexture: 2, skyPdf: 3 } as const
export const SKY_TRACE_ENTRY = 'skyLightTrace'
export const SKY_RAYS_ENTRY = 'skyLightRays'
export const SKY_COMPOSITE_ENTRY = 'skyLightComposite'
/** The floats of a ray record: the direction and the weight (the reciprocal of the mixed density). */
export const SKY_RAY_FLOATS = 4

const RAY_BLOCK = wgslBlock(
  'SKY_LIGHT_RAY_WGSL',
  [PT_SKY_WGSL, sampleSphereEven],
  `/** The share of the samples drawn from the sky's table: half, none where the table is constant (its density minus its mean is nil). */
fn skyStrategy()->f32{return select(0.0,0.5,ptSkyEstimate()>0.0);}`,
)

/**
 * THE DIRECTIONS OF THE RAYS (`skyLightRays`, a thread a pixel of the table of `SKY_RAYS_SIDE` pixels a side, `params.sizes.z` samples each): a sample is drawn from the pixel's own two
 * numbers of the sequence; the share `skyStrategy` of them chooses a direction by the sky's table (`ptSkySample`), the rest a direction of the sphere (even), and the weight stored with the direction
 * is the reciprocal of the mix of the sphere's density and the table's density of that direction. The record of pixel p, sample s is at `(p.y * side + p.x) * samples + s`.
 */
const RAYS_WGSL = `
struct SkyRayParams{sizes:vec4u,trace:vec4f,}
struct SkyRay{direction:vec3f,weight:f32,}
@group(0) @binding(${SKY_RAYS_BINDINGS.params}) var<uniform> params:SkyRayParams;
@group(0) @binding(${SKY_RAYS_BINDINGS.rays}) var<storage,read_write> outRays:array<SkyRay>;
@group(0) @binding(${SKY_RAYS_BINDINGS.skyTexture}) var ptSkyTexture:texture_2d<f32>;
@group(0) @binding(${SKY_RAYS_BINDINGS.skyPdf}) var ptSkyPdf:texture_2d<f32>;
@compute @workgroup_size(${SKY_RAYS_GROUP},${SKY_RAYS_GROUP},1)
fn ${SKY_RAYS_ENTRY}(@builtin(global_invocation_id) gid:vec3u){
 if(any(gid.xy>=vec2u(${SKY_RAYS_SIDE}u))){return;}
 let strategy=skyStrategy();
 let samples=params.sizes.z;
 for(var s=0u;s<samples;s++){
  var rng=ptRandCreateDiffused(gid.xy,params.sizes.w,s,samples);
  var e=ptRand2(&rng);
  var direction:vec3f;
  var skyPdf:f32;
  if(e.x<strategy){
   e.x/=strategy;
   let picked=ptSkySample(e);
   direction=picked.direction;
   skyPdf=picked.pdf;
  }else{
   e.x=(e.x-strategy)/(1.0-strategy);
   direction=sampleSphereEven(e);
   skyPdf=ptSkyEval(direction).w;
  }
  let uniformPdf=1.0/(4.0*PI);
  outRays[(gid.y*${SKY_RAYS_SIDE}u+gid.x)*samples+s]=SkyRay(direction,1.0/mix(uniformPdf,skyPdf,strategy));
 }
}`

/** The program of the pass that draws the rays' directions. */
export const skyRaysProgram = () => wgslProgram(RAYS_WGSL, [PT_RANDOM_WGSL, RAY_BLOCK, PI])

const TRACE_PARAMS = wgslBlock(
  'SKY_LIGHT_TRACE_PARAMS_WGSL',
  [],
  `struct SkyTraceParams{
 sizes:vec4u,
 window:vec4u,
 trace:vec4f,
 flags:vec4u,
 more:vec4f,
 model:vec4u,
}
struct SkyRay{direction:vec3f,weight:f32,}
@group(0) @binding(${SKY_TRACE_BINDINGS.params}) var<uniform> params:SkyTraceParams;
@group(0) @binding(${SKY_TRACE_BINDINGS.normals}) var normals:texture_2d<f32>;
@group(0) @binding(${SKY_TRACE_BINDINGS.flags}) var flags:texture_2d<u32>;
@group(0) @binding(${SKY_TRACE_BINDINGS.light}) var skyLightOut:texture_storage_2d<rgba16float,write>;
@group(0) @binding(${SKY_TRACE_BINDINGS.open}) var skyOpenOut:texture_storage_2d<rg32float,write>;
@group(0) @binding(${SKY_TRACE_BINDINGS.rays}) var<storage,read> inRays:array<SkyRay>;
@group(0) @binding(${SKY_TRACE_BINDINGS.skyTexture}) var ptSkyTexture:texture_2d<f32>;
@group(0) @binding(${SKY_TRACE_BINDINGS.skyPdf}) var ptSkyPdf:texture_2d<f32>;`,
)

/** Centimetres in a metre: the thickness of the hair's shadow is measured in them. */
const CENTIMETRES = 100

/** How far the strands' voxels are marched along a ray, in metres: 1000 centimetres, the reference's `DistanceThreshold`. */
const HAIR_DISTANCE = 10

/**
 * THE STRANDS' VOXELS ON A SKY RAY (`skyHairHit`, the reference's `TraverseHair`, taking the ray's scene hit `hitT`, -1 for none, and giving the nearer of it and the strands'): the ray, shortened to
 * the scene's hit or to `HAIR_DISTANCE`, is marched through the voxels of each macro group, its start moved by the bias of a voxel along the ray and by a random vector of the voxel's size,
 * the march ending where the hair count passes the threshold (`params.model.z`, a float's bits, `rayTracedSkyLightHairOcclusionThreshold`). The two random numbers come from the pixel's sequence of the frame (`params.model.y` = 1, the time-random jitter) or from
 * the pixel alone. The density and the stepping are `params.more.z` and `params.more.w`.
 */
const hairVoxelBlock = () => {
  const names = voxelNamesOf('sky')
  const H = SKY_TRACE_HAIR
  return wgslBlock(
    'SKY_LIGHT_HAIR_VOXEL_WGSL',
    [
      TRACE_PARAMS,
      PT_RANDOM_WGSL,
      rand3dPcg16,
      voxelParamsWgsl(names, H.group, H.params),
      voxelTraversalWgsl(true, false, names),
    ],
    `@group(${H.group}) @binding(${H.nodes}) var<storage,read> ${names.nodes}:array<u32>;
@group(${H.group}) @binding(${H.pageIndex}) var<storage,read> ${names.pageIndex}:array<u32>;
@group(${H.group}) @binding(${H.voxels}) var<storage,read> ${names.voxels}:array<u32>;
fn skyHairHit(pixel:vec2u,origin:vec3f,direction:vec3f,hitT:f32)->f32{
 var voxelRandom=vec3f(0.5);
 var rayRandom=1.0;
 if(params.model.y==1u){
  var sequence=ptRandCreate(pixel.y*params.sizes.x+pixel.x,params.flags.w);
  let e=ptRand4(&sequence);
  voxelRandom=e.xyz;
  rayRandom=e.w;
 }else{
  let first=rand3dPcg16(vec3i(vec2i(pixel),0)).xy;
  let second=rand3dPcg16(vec3i(vec2i(pixel)+vec2i(17),0)).xy;
  let e=vec4f(vec4u(first,second))/65536.0;
  voxelRandom=e.xyz;
  rayRandom=e.w;
 }
 var nearest=hitT;
 let reach=select(${HAIR_DISTANCE}.0,min(hitT,${HAIR_DISTANCE}.0),hitT>=0.0);
 let end=origin+direction*reach;
 for(var group=0u;group<${names.params}.macroGroupCount;group++){
  let node=nodeOf(group);
  let bias=(rayRandom*direction+voxelRandom)*node.size;
  let traced=traceVoxels(origin+bias,end+bias,node,TraversalSettings(params.more.z,bitcast<f32>(params.model.z),${HAIR_DISTANCE}.0,params.more.w,voxelRandom,0.0,true,false));
  if(traced.hitT>=0.0){nearest=select(traced.hitT,min(nearest,traced.hitT),nearest>=0.0);}
 }
 return nearest;
}`,
  )
}

/**
 * THE SKY LIGHT'S TRACE (`skyLightTrace`, a thread a pixel of the rays' grid, the image divided by `params.sizes.w` — the upscale — on each side): the pixel traced is the grid's cell times the
 * upscale plus an offset that visits the cell's pixels in turn with the frame (the frame modulo the cell's pixel count, so that a cell of any side is visited whole). A lit, finite pixel casts `params.sizes.z` rays:
 *  - the decoupled direction of the record at the cell, repeated over the table (`params.flags.x` on), or, off, a direction drawn here: half by the sky's table, half in the cosine lobe about the normal;
 *  - the start: where the ray faces the surface, toward the eye and off the normal by the bias (`rayOrigin`); where it points under it, off the back of the normal by the bias alone;
 *  - the ray ends at the first primitive (`params.flags.y` casts from both faces, `params.flags.z` lets the masks of the masked surfaces cut);
 *  - a ray that hits adds its distance and one hit; one that does not adds the sky's radiance along it, times the cosine over pi (the Lambert diffuse without its colour) and the ray's weight.
 * Where the view has strands' voxels (`hairVoxel`, the variant of the program that binds them), a ray of a pixel that is not hair is also marched through them (`skyHairHit`) and counts as a hit where they hold it.
 * The light is the sum over the samples, averaged, times the exposure; the distance of the hits is averaged. The light is written in the rgb of `light` with the share of the rays that hit in its
 * alpha, and the distance of the hits (-1 for none) with the number of rays (0 for a pixel not traced) in the red and green of `open`: the denoiser's signal; the albedo is applied after the denoiser.
 */
const traceWgsl = (hairVoxel: boolean) => `
fn skyTraced(word:u32,z:f32)->bool{return z!=0.0&&(word&${SURFACE_MODEL_MASK}u)!=${UNLIT_FLAG}u;}
fn skyBelow(P:vec3f,N:vec3f,D:vec3f)->vec3f{
 let least=params.more.x;
 return P-N*mix(max(least,params.trace.z),least,saturate(dot(-N,D)));
}
@compute @workgroup_size(${SKY_TRACE_GROUP},${SKY_TRACE_GROUP},1)
fn ${SKY_TRACE_ENTRY}(@builtin(global_invocation_id) gid:vec3u){
 let cell=gid.xy+params.window.xy;
 if(any(cell>=params.window.zw)){return;}
 let up=params.sizes.w;
 let sub=params.flags.w%(up*up);
 let pixel=cell*up+vec2u(sub%up,sub/up);
 let at=vec2i(pixel);
 let inside=all(pixel<textureDimensions(flags));
 let z=select(0.0,hizOpaqueDepth(at),inside);
 let word=select(0u,textureLoad(flags,at,0).r,inside);
 let samples=select(0u,params.sizes.z,skyTraced(word,z));
 var radiance=vec3f(0.0);
 var hits=0.0;
 var travelled=0.0;
 var bent=vec3f(0.0);
 var lit=vec4f(0.0);
 var albedo=vec3f(0.0);
 var hair=false;
 var scattered=vec3f(0.0);
 var P=vec3f(0.0);
 var N=vec3f(0.0);
 var V=vec3f(0.0);
 if(samples>0u){
  P=worldAt(vec2f(pixel)+vec2f(0.5),z);
  let normalRough=textureLoad(normals,at,0);
  N=normalize(normalRough.xyz);
  let rough=normalRough.w;
  let base=textureLoad(baseMetal,at,0);
  V=viewToEye(P);
  lit=skyModelSet(word,at,base,N,V,rough);
  albedo=skyAlbedo(base,word);
  hair=skyModelHair(word);
  let ao=surfaceEmissiveAo(at,word).w;
  let transmission=params.model.x!=0u;
  var rayFlags=ST_SHADOW|ST_SKIP_TRANSLUCENT;
  if(params.flags.y==0u){rayFlags|=ST_CULL_BACK;}
  if(params.flags.z==0u){rayFlags|=ST_FORCE_OPAQUE;}
  if(!isFirstPerson(word)){rayFlags|=ST_MEET_WORLD_SPACE;}
  let strategy=skyStrategy();
  for(var s=0u;s<samples;s++){
   var direction:vec3f;
   var weight:f32;
   if(params.flags.x!=0u){
    let tile=cell%vec2u(${SKY_RAYS_SIDE}u);
    let ray=inRays[(tile.y*${SKY_RAYS_SIDE}u+tile.x)*samples+s];
    direction=ray.direction;
    weight=ray.weight;
   }else{
    var rng=ptRandCreateDiffused(pixel,params.sizes.y,s,samples);
    var e=ptRand2(&rng);
    var cosinePdf:f32;
    var skyPdf:f32;
    if(e.x<strategy){
     e.x/=strategy;
     let picked=ptSkySample(e);
     direction=picked.direction;
     skyPdf=picked.pdf;
     cosinePdf=saturate(dot(N,direction))/PI;
    }else{
     e.x=(e.x-strategy)/(1.0-strategy);
     let disk=uniformDiskConcentric(e);
     let cosine=sqrt(max(1.0-dot(disk,disk),0.0));
     direction=outOfFrame(vec3f(disk,cosine),frameAround(N));
     cosinePdf=cosine/PI;
     skyPdf=ptSkyEval(direction).w;
    }
    weight=1.0/mix(cosinePdf,skyPdf,strategy);
   }
   var Nc=N;
   if(hair){Nc=normalize(direction-N*dot(direction,N));}
   let facing=dot(Nc,direction);
   var origin=skyBelow(P,Nc,direction);
   if(facing>0.0){origin=rayOrigin(P,Nc,direction,params.trace.z,params.more.x);}
   let hit=stTrace(StRay(origin-view.display.yzw,direction,0.0,params.trace.x,rayFlags));
   // A trace the iteration bound stopped without a hit blocks the ray (nothing is lit through an unfinished walk) at distance 0, as the shadow rays count it, not at the ray's end.
   var hitT=select(select(-1.0,0.0,!stComplete),max(hit.distance,0.0),hit.hit);
${hairVoxel ? '   if(!hair){hitT=skyHairHit(pixel,origin-view.display.yzw,direction,hitT);}\n' : ''}   if(hitT>=0.0){
    hits+=1.0;
    travelled+=hitT;
   }else{
    bent+=direction;
    radiance+=ptSkyEval(direction).xyz*skyModelThroughput(albedo,lit,rough,N,V,direction,facing,ao,transmission)*weight;
   }
  }
  if(hair){
   let L=select(normalize(bent),N,all(bent==vec3f(0.0)));
   let reach=params.more.y;
   let back=stTrace(StRay(P+L*reach-view.display.yzw,-L,0.0,reach,rayFlags));
   // The thickness of the shadow, in centimetres held to one: the ray from the far end of the reach back to the point.
   let thickness=select(1.0,min((reach-back.distance)*${CENTIMETRES}.0,1.0),back.hit);
   let scatter=PI*kajiyaKayDiffuse(lit.rgb,modelScatter,L,V,N,thickness);
   scattered=skyLightDiffuse(L)*scatter*(1.0-hits/f32(samples));
  }
 }
 let count=f32(samples);
 let share=select(0.0,1.0/count,samples>0u);
 let distance=select(-1.0,travelled/max(hits,1.0),hits>0.0);
 // The light is divided by the diffuse colour here (the composite multiplies it back, after the denoiser).
 let sum=radiance*share+scattered;
 let divided=select(sum,sum/albedo,albedo>vec3f(0.0));
 let light=min(divided*params.trace.w,vec3f(65504.0));
 textureStore(skyLightOut,vec2i(cell),vec4f(light,hits*share));
 textureStore(skyOpenOut,vec2i(cell),vec4f(distance,count,0.0,0.0));
}`

const traceText = wgslVariants(traceWgsl)

/** The program of the trace: its own textures in group 0, the reflection group (the view and the depth pyramid) and the scene trace's group, whose rays cut the surfaces by the graph masks `programs`; with `hairVoxel`, the strands' voxels in a group after them. */
export const skyTraceProgram = (programs: SceneMaskPrograms = NO_SCENE_MASKS, hairVoxel = false) =>
  wgslProgram(traceText(hairVoxel), [
    TRACE_PARAMS,
    PT_RANDOM_WGSL,
    RAY_BLOCK,
    PI,
    uniformDiskConcentric,
    frameAround,
    outOfFrame,
    WORLD_AT_WGSL,
    SKY_MODEL_WGSL,
    RAY_ORIGIN_WGSL,
    isFirstPerson,
    REFLECTION_CONSTANTS_WGSL,
    reflectionBindingsWgsl(REFLECTION_GROUP),
    reflectionLightViewWgsl(REFLECTION_GROUP),
    sceneTraceWgsl(SKY_TRACE_SCENE.group, SKY_TRACE_SCENE.first),
    sceneMaskWgsl(SKY_TRACE_SCENE.group, SKY_TRACE_SCENE.first, programs),
    ...(hairVoxel ? [hairVoxelBlock()] : []),
  ])

export const SKY_COMPOSITE_BINDINGS = { sky: 0, base: 1, params: 2, flags: 3 } as const

/**
 * THE COMPOSITE (`skyLightComposite`, a fullscreen pass blended additively into the lit image): the sky light the trace and the denoiser left at the pixel's cell (`params.ratio.x` pixels a side,
 * read by load), times the pixel's diffuse colour (`skyAlbedo`: its base colour less what its metalness spends of it, a hair's and an eye's whole), which the trace left out
 * so that the denoiser filtered the light alone. The alpha added is nil: the lit image's alpha is the light the subsurface scattering spreads.
 */
const COMPOSITE_WGSL = `
@group(0) @binding(${SKY_COMPOSITE_BINDINGS.sky}) var skyLightTexture:texture_2d<f32>;
@group(0) @binding(${SKY_COMPOSITE_BINDINGS.base}) var baseMetal:texture_2d<f32>;
@group(0) @binding(${SKY_COMPOSITE_BINDINGS.flags}) var flags:texture_2d<u32>;
struct SkyCompositeParams{ratio:vec4f,}
@group(0) @binding(${SKY_COMPOSITE_BINDINGS.params}) var<uniform> params:SkyCompositeParams;
@vertex fn fullscreen(@builtin(vertex_index) i:u32)->@builtin(position) vec4f{
 return vec4f(f32(i32(i&1u)*4-1),f32(i32(i>>1u)*4-1),0.0,1.0);
}
@fragment fn ${SKY_COMPOSITE_ENTRY}(@builtin(position) position:vec4f)->@location(0) vec4f{
 let pixel=vec2i(position.xy);
 let base=textureLoad(baseMetal,pixel,0);
 let albedo=skyAlbedo(base,textureLoad(flags,pixel,0).r);
 let size=vec2i(textureDimensions(skyLightTexture));
 let texel=min(pixel/vec2i(i32(params.ratio.x)),size-vec2i(1));
 return vec4f(textureLoad(skyLightTexture,texel,0).rgb*albedo,0.0);
}`

/** The program of the composite. */
export const skyCompositeProgram = () => wgslProgram(COMPOSITE_WGSL, [SKY_ALBEDO_WGSL])
