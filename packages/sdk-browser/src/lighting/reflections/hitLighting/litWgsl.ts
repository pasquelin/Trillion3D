import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { octDecode } from '../../../../../math/src/wgsl/octahedral.ts'
import { GROUP_GRID_WGSL } from '../../../gpu/dispatch/grid.ts'
import { listWgsl } from '../../../gpu/dispatch/list.ts'
import { reflectionHitWords } from '../grids.ts'
import { REFLECTION_TRACE_BINDINGS as B } from '../trace/traceBindings.ts'
import { REFLECTION_REACH_WGSL } from '../reach.ts'
import { LIT_BOUNCE_VECS, REFLECTION_HIT_LIT, REFLECTION_HIT_MATERIAL_WORD } from './constants.ts'
import { litDirectHostWgsl, litListWgsl, litPathHostOf } from './hostWgsl.ts'
import { LIT_RESOLVE_WGSL, litPathWgsl, litScaleWgsl } from './pathWgsl.ts'

/** The threads of a workgroup of the hit lighting's passes. */
export const LIT_THREADS = 64
/** The bindings of the compaction's module (group 0); each of its entries binds the ones it reads or writes alone (`kernels.ts`), so that the list of passes that is dispatched from `args` never binds it as storage. */
export const LIT_COMPACT_BINDINGS = {
  params: 0,
  pending: 1,
  hits: 2,
  list: 3,
  materials: 4,
  sorted: 5,
  args: 6,
} as const
const C = LIT_COMPACT_BINDINGS
/** The format of the texture the compaction writes the material of each trace in, for the sort. */
export const LIT_MATERIAL_FORMAT: GPUTextureFormat = 'r32uint'

/**
 * THE TRACES TO LIGHT AGAIN, COLLECTED (`litCompact`, a thread a ray the scene stage answered): the rays whose hit the answer marked (`REFLECTION_HIT_LIT`) are appended
 * to the list `litList` (the count first, then the texel's place and where the screen stopped knowing the ray) and the key of the hit's material (`litMaterialKey`, the
 * fifteen low bits of the hit's last word, with the sixteenth bit set) is written at the texel of `litMaterials`, which the sort reads. The record of a hit is found by the
 * grid's width of the image (`lp.width`, written every image). `litDispatch` makes the dispatch of the passes over the list (workgroups of `LIT_THREADS`, in rows of at most the device's workgroups a dimension, in words 3 to 5 of `litArgs`,
 * the sort's own in words 0 to 2); `litCopy` hands the list on unsorted where the materials are not bucketed.
 */
export const litCompactProgram = () =>
  wgslProgram(
    `struct LitParams{width:u32,a:u32,b:u32,c:u32,}
@group(0) @binding(${C.params}) var<uniform> lp:LitParams;
@group(0) @binding(${C.hits}) var<storage,read> litHits:array<u32>;
struct LitList{count:atomic<u32>,entries:array<vec2u>,}
@group(0) @binding(${C.list}) var<storage,read_write> litList:LitList;
@group(0) @binding(${C.materials}) var litMaterials:texture_storage_2d<${LIT_MATERIAL_FORMAT},write>;
@group(0) @binding(${C.sorted}) var<storage,read_write> sortedList:array<vec2u>;
@group(0) @binding(${C.args}) var<storage,read_write> litArgs:array<u32,6>;
@compute @workgroup_size(${LIT_THREADS})
fn litCompact(@builtin(global_invocation_id) thread:vec3u,@builtin(num_workgroups) groups:vec3u){
 let at=flatIndex(thread,groups,${LIT_THREADS}u);
 if(at>=pendingIn.count){return;}
 let missed=pendingIn.entries[at];
 let texel=vec2u(missed.x&0xffffu,missed.x>>16u);
 let record=(texel.y*lp.width+texel.x)*${reflectionHitWords(true)}u;
 if((litHits[record]&${REFLECTION_HIT_LIT}u)==0u){return;}
 let place=atomicAdd(&litList.count,1u);
 litList.entries[place]=missed;
 textureStore(litMaterials,vec2i(texel),vec4u((litHits[record+${REFLECTION_HIT_MATERIAL_WORD}u]&0x7fffu)|0x8000u,0u,0u,0u));
}
@compute @workgroup_size(1)
fn litDispatch(){
 let grid=groupGrid(ceilDiv(atomicLoad(&litList.count),${LIT_THREADS}u));
 litArgs[3]=grid.x;
 litArgs[4]=grid.y;
 litArgs[5]=1u;
}
@compute @workgroup_size(${LIT_THREADS})
fn litCopy(@builtin(global_invocation_id) thread:vec3u,@builtin(num_workgroups) groups:vec3u){
 let at=flatIndex(thread,groups,${LIT_THREADS}u);
 if(at<atomicLoad(&litList.count)){sortedList[at]=litList.entries[at];}
}`,
    [
      GROUP_GRID_WGSL,
      listWgsl({ name: 'pendingIn', group: 0, binding: C.pending, entry: 'vec2u', append: false }),
    ],
  )

/** The vec4u the first vertex of a reflection trace holds in the radiance buffer (the vertices after it hold `LIT_BOUNCE_VECS`): its light and its colours, the hit it was made at being the scene stage's record. */
const LIT_FIRST_VECS = 2

/** The sides of the path the reflections choose: the light functions' atlas as a storage texture and the light profiles' (the eye their fade is measured from is the view's), the exposure of the view (its own, in `ReflectionView.radiance.z`) and its pre-exposure. */
export const LIT_PATH_HOST = litPathHostOf(
  {
    lightFunction: B.litFunction,
    lightProfile: B.litProfile,
    lightProfileSampler: B.litProfileSampler,
  },
  'view.display.yzw',
  'reflectionView.radiance.z',
  'view.preExposure.x',
)

/** The ray of the trace to light, as both passes take it up: the pixel the texel casts from, its stored ray and cone, and the scene ray. */
const PRELUDE = `/** The ray of the grid texel g the scene stage cast: its picked pixel, its point and top normal, its direction, its cone angle and the scene ray (origin, start, end, flags). */
struct LitTrace{coord:vec2i,own:ReflectingPoint,R:vec3f,cone:f32,ray:ReflectionSceneRay,firstPerson:bool,}
fn litTraceOf(g:vec2u,begin:f32)->LitTrace{
 let coord=vec2i(reflectionPickedPixel(g));
 let own=reflectingPointAt(REFLECTION_LAYER,coord);
 let stored=reflectionStoredRay(vec2i(g));
 let R=reflectionRayLobe(stored.ray).R;
 return LitTrace(coord,own,R,stored.cone,reflectionSceneRayOf(own.P,own.topN,R,begin,stored.firstPerson),stored.firstPerson);
}
/** The place of the texel g in the hit lighting's radiance buffer: a trace holds LIT_FIRST_VECS vec4u for its first vertex, then four for each vertex more a path of the view can hold (its reflection bounces over its refraction stretches; the vertex k, litVertexAt). */
fn litSlot(g:vec2u)->u32{return (g.y*reflectionGridSize().x+g.x)*(${LIT_FIRST_VECS}u+${LIT_BOUNCE_VECS}u*(hitLightVertices()-1u));}`

/** What the first pass asks of the reflections: the lobe's trace share, a sun shadow ray running as far as the view's longest ray, and no back face reaching it (the trace culls them). */
export const LIT_DIRECT_HOST = litDirectHostWgsl({
  traceShare: 'reflectionTraceShare(alpha,0u)',
  sunReach: 'reflectionView.march.w',
  backFaceEnds: 'false',
})

/**
 * THE FIRST PASS OF THE HIT LIGHTING (`litDirect`, a thread a trace of the sorted list): the scene stage's ray of the texel and where it met the surface (its record) go to the path (`litPath`, `pathWgsl.ts`), the reflections culling the back faces
 * in the trace as the scene stage does and drawing the path's noise from the texel and the image's turn. The reflections' share of the next ray is the lobe's trace share (`reflectionTraceShare`).
 */
export const LIT_DIRECT_WGSL = wgslBlock(
  'LIT_DIRECT_WGSL',
  [
    litPathWgsl(LIT_PATH_HOST),
    REFLECTION_REACH_WGSL,
    litListWgsl(B, LIT_FIRST_VECS, true),
    LIT_DIRECT_HOST,
  ],
  `${PRELUDE}
@compute @workgroup_size(${LIT_THREADS})
fn litDirect(@builtin(global_invocation_id) thread:vec3u,@builtin(num_workgroups) groups:vec3u){
 let at=flatIndex(thread,groups,${LIT_THREADS}u);
 if(at>=litList.count){return;}
 let entry=litSorted[at];
 let g=vec2u(entry.x&0xffffu,entry.x>>16u);
 let trace=litTraceOf(g,bitcast<f32>(entry.y));
 let record=reflectionHitAt(g);
 let found=bitcast<f32>(reflectionHits[record+1u]);
 let rng=ptRandCreateDiffused(g,reflectionView.temporal.y,directLights.count,directLights.count+1u);
 litPath(litSlot(g),LitStart(trace.R,LitRay(trace.ray.origin,trace.ray.far,trace.ray.flags)),found,rng);
}`,
)

/**
 * THE SECOND PASS OF THE HIT LIGHTING (`litFinish`, a thread a trace of the sorted list, in the program whose cards are read for their indirect light): the path's vertices are given their indirect light (`litResolve`, `pathWgsl.ts`: the cards of the hit's
 * placement over the cone of the ray, here) and the sum goes the way a hit's light goes (`reflectionSeenAt`: the lit image where it agrees, fog, the ceiling of a ray, the fog laid from the surface the ray left) to the texel of the fresh grid.
 * A trace the first pass left invalid keeps the answer the scene stage gave it.
 */
export const LIT_FINISH_WGSL = wgslBlock(
  'LIT_FINISH_WGSL',
  [
    LIT_RESOLVE_WGSL,
    litScaleWgsl(LIT_PATH_HOST.scale),
    octDecode,
    litListWgsl(B, LIT_FIRST_VECS, false),
  ],
  `${PRELUDE}
fn litCards(object:u32,P:vec3f,N:vec3f,distance:f32,look:LitLook)->ScHit{
 let radius=reflectionHitSpread(look.cone)*distance*REFLECTION_CENTIMETRES;
 return scEvaluateMeshCards(scPlacementMeshCards(scHitPlacement(object)),P*REFLECTION_CENTIMETRES,N,radius,reflectionView.hardware.w,reflectionDone(REFLECTION_HI_RES_SURFACE),look.coord);
}
@compute @workgroup_size(${LIT_THREADS})
fn litFinish(@builtin(global_invocation_id) thread:vec3u,@builtin(num_workgroups) groups:vec3u){
 let at=flatIndex(thread,groups,${LIT_THREADS}u);
 if(at>=litList.count){return;}
 let entry=litSorted[at];
 let g=vec2u(entry.x&0xffffu,entry.x>>16u);
 if(litUnpack(litRadiance[litSlot(g)].xy).w<0.5){return;}
 let trace=litTraceOf(g,bitcast<f32>(entry.y));
 let record=reflectionHitAt(g);
 let found=bitcast<f32>(reflectionHits[record+1u]);
 let N0=octDecode(unpack2x16snorm(reflectionHits[record+2u]));
 let at3=trace.ray.origin+trace.R*found;
 // The first hit is the one the scene stage met (its point, normal and object are the hits' record).
 let radiance=litResolve(litSlot(g),trace.R,LitHit(at3,N0,reflectionHits[record+3u],found),LitLook(trace.cone,g));
 reflectionOrigin=trace.own.P;
 let seen=reflectionSeenAt(radiance,at3,N0,g);
 textureStore(traceOut,vec2i(g),freshPack(makeFinite3(seen),found));
}`,
)
