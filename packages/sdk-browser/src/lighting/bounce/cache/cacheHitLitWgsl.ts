import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { makeFinite3 } from '../../../../../math/src/wgsl/integer.ts'
import { dagReadLayoutEntries } from '../../../geometry/dag/shader/bindings.ts'
import {
  COMPUTE,
  computeBufferEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../../gpu/core/computeBindings.ts'
import { WORD_LIGHT_FORMAT, type LightAtlasFormat } from '../../../gpu/core/lightAtlasFormat.ts'
import { FLAT_INDEX_WGSL } from '../../../gpu/dispatch/grid.ts'
import { skyLightReadLayoutEntries } from '../../../modules/sky/skyLight/read.ts'
import { SKY_READ_WGSL } from '../../atmosphere/skyReadWgsl.ts'
import { DIRECT_LIGHT_WGSL } from '../../direct/lightWgsl.ts'
import { lightFunctionLayoutEntry } from '../../lightFunction/bindings.ts'
import { lightProfileLayoutEntries } from '../../lightProfile/profileBindings.ts'
import { hitLightModeWgsl, LIT_SINGLE_VECS } from '../../reflections/hitLighting/constants.ts'
import {
  litDirectHostWgsl,
  litListWgsl,
  litPathHostOf,
} from '../../reflections/hitLighting/hostWgsl.ts'
import { LIT_THREADS } from '../../reflections/hitLighting/litWgsl.ts'
import {
  LIT_RESOLVE_WGSL,
  litPathWgsl,
  litScaleWgsl,
} from '../../reflections/hitLighting/pathWgsl.ts'
import { NO_SCENE_MASKS, type SceneMaskPrograms } from '../../rays/sceneTrace/sceneMaskPrograms.ts'
import { sceneMaskWgsl } from '../../rays/sceneTrace/sceneMaskWgsl.ts'
import { sceneTraceWgsl } from '../../rays/sceneTrace/sceneTraceWgsl.ts'
import { surfaceHitCardsLayoutEntries } from '../../surfaceCache/hitWgsl.ts'
import { VISUALIZE_MODE } from '../../surfaceCache/visualizeModes.ts'
import { skyLightReadWgsl } from '../../../modules/sky/skyLight/read.ts'
import { bounceBindingsWgsl } from '../gridWgsl.ts'
import { QUEUED_PROBE_WGSL } from '../probes/probeQueueWgsl.ts'
import { BOUNCE_CM_WGSL, tracedCardLightWgsl, tracedLitCardsWgsl } from '../tracedHitWgsl.ts'
import {
  CACHE_LIT_BINDINGS as O,
  CACHE_SPLAT_BINDINGS,
  CACHE_TRACED_HIT,
  CACHE_TRACED_SCENE,
  CACHE_TRACE_BINDINGS as B,
  CACHE_TRACE_SKY_LIGHT,
  cacheKernelEntries,
} from './cacheBindings.ts'
import { CACHE_LIT_MARK_WGSL, CACHE_LIT_MARK } from './cacheLitMark.ts'
import {
  CACHE_SKY_LEAK_WGSL,
  TRACE_ATLAS_AT_WGSL,
  atlasRayLight,
  cacheRawWord,
  tileKernel,
} from './cacheTraceWgsl.ts'
import { cacheTileList } from './cacheTilesWgsl.ts'
import {
  CACHE_TILE_SIDE,
  RADIANCE_CACHE_FLAGS,
  RADIANCE_CACHE_PARAMS,
  radianceRawFormat,
} from './cacheLayout.ts'
import { CACHE_WORDS_WGSL } from './cacheWordsWgsl.ts'

/** The compaction's bindings (group 0): those of the spread's kernel up to the tile list, then the texture the trace marked its hits in and the list of the hits to light that it fills. */
export const CACHE_LIT_COMPACT_BINDINGS = {
  grid: CACHE_SPLAT_BINDINGS.grid,
  table: CACHE_SPLAT_BINDINGS.table,
  queue: CACHE_SPLAT_BINDINGS.queue,
  params: CACHE_SPLAT_BINDINGS.params,
  tiles: CACHE_SPLAT_BINDINGS.tiles,
  marks: 5,
  litList: 6,
} as const

/** The cards the second pass reads: the surface cache's indirect light (the direct light is made at the hit), at the same bindings as the trace that marks the hits. */
export const CACHE_LIT_HIT = { ...CACHE_TRACED_HIT, visualize: VISUALIZE_MODE.indirectLighting }
/** The path as the cache casts it: from its eye, its lights strengthened under the exposure of the image the update was queued in (`cache.litExposure`) and held under the pre-exposure the cache keeps its light under; the light functions' fade is measured from the cache's eye. */
export const CACHE_LIT_HOST = litPathHostOf(
  {
    lightFunction: O.lightFunction,
    lightProfile: O.lightProfile,
    lightProfileSampler: O.lightProfileSampler,
  },
  'cache.eye.xyz',
  'cache.litExposure',
  'bounce.reach.z',
)

/** The layouts of the passes' group 0. */
export const cacheLitCompactEntries = () => {
  const C = CACHE_LIT_COMPACT_BINDINGS
  return [
    ...cacheKernelEntries(C),
    computeBufferEntry(C.tiles, 'read-only-storage'),
    computeTextureEntry(C.marks, 'uint'),
    computeBufferEntry(C.litList, 'storage'),
  ]
}
const listEntries = (list: 'read-only-storage' | 'storage') => [
  computeBufferEntry(O.litList, 'read-only-storage'),
  computeBufferEntry(O.litSorted, 'read-only-storage'),
  computeBufferEntry(O.litRadiance, list),
]
/** The bindings the passes over the list read to find the ray of an entry: the probes' (the levels, the cell table, the queue), the cache's parameters and the texture the trace marked its hits in, which holds the tile each ray was traced from. */
const rayEntries = () => [
  computeUniformEntry(B.grid),
  computeBufferEntry(B.queue, 'read-only-storage'),
  computeTextureEntry(B.table, 'float', '2d-array'),
  computeUniformEntry(B.params),
  computeTextureEntry(O.marks, 'uint'),
]
export const cacheLitDirectEntries = () => [
  ...rayEntries(),
  computeBufferEntry(B.lights, 'read-only-storage'),
  ...listEntries('storage'),
  ...dagReadLayoutEntries(),
  lightFunctionLayoutEntry(O.lightFunction, undefined, true),
  ...lightProfileLayoutEntries(CACHE_LIT_HOST.lightProfile),
]
export const cacheLitFinishEntries = (light: LightAtlasFormat = WORD_LIGHT_FORMAT) => [
  ...rayEntries(),
  computeStorageTextureEntry(B.raw, radianceRawFormat(light)),
  ...listEntries('read-only-storage'),
  ...skyLightReadLayoutEntries(CACHE_TRACE_SKY_LIGHT, COMPUTE),
  ...surfaceHitCardsLayoutEntries(CACHE_LIT_HIT, light),
]

/** The cache's parameters and the probe queue under the bindings `at` of the kernel's own table (the compaction's is the spread's, the passes over the list the trace's). */
const paramsOf = (at: {
  readonly queue: number
  readonly params: number
}) => `${RADIANCE_CACHE_PARAMS.wgsl}
@group(0) @binding(${at.queue}) var<storage,read> probeQueue:array<u32>;
@group(0) @binding(${at.params}) var<uniform> cache:RadianceCacheParams;
${wgslConsts({ CACHE_TILE_SIDE, CACHE_FLAG_TRACED: RADIANCE_CACHE_FLAGS.traced, CACHE_FLAG_LEAK: RADIANCE_CACHE_FLAGS.leak })}`

/**
 * THE RAY OF AN ENTRY OF THE LIST (`cacheLitRayAt`): the entry names the texel of the trace atlas its ray was written to; the marks texture holds there the tile list's entry the ray was traced from (the probe, the level and the tile's coordinates), and so
 * the ray's texel in the probe's map, its direction and the noise coordinate the trace drew it with. `marks` is the texture the program declares.
 */
const CACHE_LIT_RAY_WGSL = wgslBlock(
  'CACHE_LIT_RAY_WGSL',
  [CACHE_WORDS_WGSL, QUEUED_PROBE_WGSL, TRACE_ATLAS_AT_WGSL],
  `struct CacheLitRay{queued:QueuedProbe,trace:u32,rank:u32,local:vec2u,coord:vec2u,direction:vec3f,}
fn cacheLitRayAt(place:vec2u)->CacheLitRay{
 let local=place%CACHE_TILE_SIDE;
 let tile=place/CACHE_TILE_SIDE;
 let rank=tile.x+tile.y*CACHE_TRACE_ATLAS_TILES;
 let entry=textureLoad(marks,vec2i(place),0).zw;
 let queued=queuedProbe(entry.x&0xffffu);
 let trace=(cache.resolution/2u)<<(entry.x>>16u);
 let texel=vec2u(entry.y&0xffffu,entry.y>>16u)*CACHE_TILE_SIDE+local;
 let d=equalAreaDecode((vec2f(texel)+vec2f(0.5))/f32(trace));
 return CacheLitRay(queued,trace,rank,local,cacheNoiseOrigin(queued.cell,queued.level+(queued.rank<<8u))+texel,d);
}`,
)

/** The entry of the list `at` of the passes' thread, its texel in the trace atlas and the distance of its hit, as the passes over the list read them. */
const LIT_ENTRY = `let entry=litSorted[at];
 let place=vec2u(entry.x&0xffffu,entry.x>>16u);
 let found=bitcast<f32>(entry.y);`

const ray = (
  at: { readonly queue: number; readonly params: number },
  declarations: string,
) => `${paramsOf(at)}
${declarations}`
/** The marks texture the passes over the list read (the compaction declares its own). */
const MARKS = `@group(0) @binding(${O.marks}) var marks:texture_2d<u32>;`

/**
 * THE COMPACTION OF THE HITS TO LIGHT (`cacheLitCompact`, a workgroup a tile of the slice of the list being traced, as the spread walks it): the rays of the tile whose texel the trace marked (`CACHE_LIT_MARK`: a hit on a triangle, the low fifteen bits
 * holding the key of its material, which is also what the sort reads in that texture) are appended to a list of the ray's texel in the trace atlas and the distance of its hit. `cacheLitReset` empties the list before each slice.
 */
export const cacheLitCompactProgram = () => {
  const C = CACHE_LIT_COMPACT_BINDINGS
  return wgslProgram(
    ray(
      C,
      `@group(0) @binding(${C.marks}) var marks:texture_2d<u32>;
struct LitCount{count:atomic<u32>,entries:array<vec2u>,}
@group(0) @binding(${C.litList}) var<storage,read_write> litList:LitCount;
@compute @workgroup_size(1)
fn cacheLitReset(){atomicStore(&litList.count,0u);}
${tileKernel(
  'cacheLitCompact',
  ` if(!inside){return;}
 let place=traceAtlasAt(rank,local);
 let mark=textureLoad(marks,vec2i(place),0).xy;
 if((mark.x&${CACHE_LIT_MARK}u)==0u){return;}
 let slot=atomicAdd(&litList.count,1u);
 litList.entries[slot]=vec2u(place.x|(place.y<<16u),mark.y);`,
)}`,
    ),
    [
      bounceBindingsWgsl(0, C.grid, C.table),
      QUEUED_PROBE_WGSL,
      CACHE_WORDS_WGSL,
      cacheTileList(C.tiles, false),
      TRACE_ATLAS_AT_WGSL,
    ],
  )
}

/**
 * THE FIRST PASS (`cacheLitDirect`, a thread a hit of the sorted list): the ray of the hit's texel is cast again from just short of the hit (`litPath`, `reflections/hitLighting/pathWgsl.ts`), from its probe's centre, with no face culled and the translucent primitives passed
 * as the trace cast it; the hit's material, the lights and their shadow rays make its light, a hit on the back of a surface that is not two-sided ending the path with none. The cache's rays have one bounce and no refraction, no reflection captures, and a shadow ray
 * toward the sun runs as far as the probes' reach.
 */
export const cacheLitDirectProgram = (programs: SceneMaskPrograms = NO_SCENE_MASKS) =>
  wgslProgram(
    ray(
      B,
      `@group(0) @binding(${B.lights}) var<storage,read> directLights:DirectLights;
${MARKS}
@compute @workgroup_size(${LIT_THREADS})
fn cacheLitDirect(@builtin(global_invocation_id) thread:vec3u,@builtin(num_workgroups) groups:vec3u){
 let at=flatIndex(thread,groups,${LIT_THREADS}u);
 if(at>=litList.count){return;}
 ${LIT_ENTRY}
 let ray=cacheLitRayAt(place);
 let rng=ptRandCreateDiffused(ray.coord,bounce.frame.z,directLights.count,directLights.count+1u);
 litPath(at*LIT_FIRST_VECS,LitStart(ray.direction,LitRay(queuedPosition(ray.queued),found+0.01,ST_SKIP_TRANSLUCENT)),found,rng);
}`,
    ),
    [
      bounceBindingsWgsl(0, B.grid, B.table),
      QUEUED_PROBE_WGSL,
      CACHE_WORDS_WGSL,
      FLAT_INDEX_WGSL,
      DIRECT_LIGHT_WGSL,
      hitLightModeWgsl('cache.lit'),
      sceneTraceWgsl(CACHE_TRACED_SCENE.group, CACHE_TRACED_SCENE.first),
      sceneMaskWgsl(CACHE_TRACED_SCENE.group, CACHE_TRACED_SCENE.first, programs),
      CACHE_LIT_RAY_WGSL,
      litPathWgsl(CACHE_LIT_HOST),
      litListWgsl(O, LIT_SINGLE_VECS, true),
      litDirectHostWgsl({
        traceShare: '0.0',
        sunReach: 'bounce.reach.x',
        backFaceEnds: '!hit.frontFace&&!hit.twoSided',
      }),
    ],
  )

/**
 * THE SECOND PASS (`cacheLitFinish`, a thread a hit of the sorted list, in the program that reads the cards): the path's vertex is given the surface cache's indirect light at the hit, or the sky light's (`litResolve`, `pathWgsl.ts`, the cards read over the footprint
 * of the ray's cone, the hits nearer than `cache.traced.z` centimetres bringing none), the sky light that leaks onto the hit is added where the cache makes irradiance maps (`cacheSkyLeak`) and the sum, under the pre-exposure the cache keeps its light under, is written to
 * the trace atlas as the stage that lights from the cards writes it, quantised and dithered as that atlas keeps it, with the word of the hit's distance and sides (the mark holds the sides). A path the first pass left invalid is black, and a sum that is not finite is taken to zero.
 */
export const cacheLitFinishProgram = (light: LightAtlasFormat = WORD_LIGHT_FORMAT) =>
  wgslProgram(
    ray(
      B,
      `${MARKS}
@group(0) @binding(${B.raw}) var traceOut:texture_storage_2d<${radianceRawFormat(light)},write>;
@compute @workgroup_size(${LIT_THREADS})
fn cacheLitFinish(@builtin(global_invocation_id) thread:vec3u,@builtin(num_workgroups) groups:vec3u){
 let at=flatIndex(thread,groups,${LIT_THREADS}u);
 if(at>=litList.count){return;}
 ${LIT_ENTRY}
 let ray=cacheLitRayAt(place);
 let mark=textureLoad(marks,vec2i(place),0).x;
 let slot=at*LIT_FIRST_VECS;
 var radiance=vec3f(0.0);
 // A path the first pass left invalid (the cast again missed the hit) is black, a hit at the distance the trace found.
 if(litUnpack(litRadiance[slot].xy).w>=0.5){
  radiance=litResolve(slot,ray.direction,LitHit(vec3f(0.0),vec3f(0.0,0.0,1.0),0u,found),LitLook(f32(ray.trace),ray.coord));
 }
 radiance+=select(vec3f(0.0),cacheSkyLeak(ray.direction,found),cacheLeaks());
 let seen=traceRayLight(makeFinite3(radiance)*bounce.reach.z,ray.rank,ray.local);
 textureStore(traceOut,vec2i(place),cacheRawWord(seen,cacheDepthWord(found,true,0.0,cacheLitFront(mark),cacheLitTwoSided(mark))));
}`,
    ),
    [
      bounceBindingsWgsl(0, B.grid, B.table),
      QUEUED_PROBE_WGSL,
      CACHE_WORDS_WGSL,
      FLAT_INDEX_WGSL,
      hitLightModeWgsl('cache.lit'),
      SKY_READ_WGSL,
      skyLightReadWgsl(CACHE_TRACE_SKY_LIGHT),
      CACHE_SKY_LEAK_WGSL,
      CACHE_LIT_MARK_WGSL,
      BOUNCE_CM_WGSL,
      tracedCardLightWgsl(CACHE_LIT_HIT, light),
      TRACE_ATLAS_AT_WGSL,
      atlasRayLight(light),
      cacheRawWord(light),
      CACHE_LIT_RAY_WGSL,
      LIT_RESOLVE_WGSL,
      litScaleWgsl(CACHE_LIT_HOST.scale),
      makeFinite3,
      litListWgsl(O, LIT_SINGLE_VECS, false),
      tracedLitCardsWgsl('cache.traced.y', 'cache.traced.z'),
    ],
  )
