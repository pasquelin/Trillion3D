import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslBlock, wgslFn, type WgslDecl } from '../../../../../math/src/wgsl/decl.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { ditherLight, packLight, unpackLight } from '../../../gpu/core/smallFloatWgsl.ts'
import { DIRECT_LIGHT_WGSL } from '../../direct/lightWgsl.ts'
import { bounceBindingsWgsl } from '../gridWgsl.ts'
import { QUEUED_PROBE_WGSL } from '../probes/probeQueueWgsl.ts'
import { probeRayWgsl } from '../probeRayWgsl.ts'
import { probeRayTracedWgsl } from '../probeRayTracedWgsl.ts'
import { SKY_READ_WGSL } from '../../atmosphere/skyReadWgsl.ts'
import { skyLightReadWgsl } from '../../../modules/sky/skyLight/read.ts'
import {
  CACHE_SPLAT_BINDINGS as S,
  CACHE_TRACED_HIT,
  CACHE_TRACED_SCENE,
  CACHE_TRACE_BINDINGS as B,
  CACHE_TRACE_HIT,
  CACHE_TRACE_SKY_LIGHT,
} from './cacheBindings.ts'
import { cacheTileList } from './cacheTilesWgsl.ts'
import {
  CACHE_TILE_SIDE,
  CACHE_TRACE_ATLAS_TILES,
  RADIANCE_CACHE_FLAGS,
  RADIANCE_CACHE_FORMATS as F,
  RADIANCE_CACHE_PARAMS,
} from './cacheLayout.ts'
import { CACHE_WORDS_WGSL } from './cacheWordsWgsl.ts'

/** The trace's bindings and its constants; `out` names the storage texture it writes, at `B.raw`: the raw atlas, or the trace atlas. */
const traceDeclarations = (out: string) => `${RADIANCE_CACHE_PARAMS.wgsl}
@group(0) @binding(${B.lights}) var<storage,read> directLights:DirectLights;
@group(0) @binding(${B.queue}) var<storage,read> probeQueue:array<u32>;
@group(0) @binding(${B.params}) var<uniform> cache:RadianceCacheParams;
@group(0) @binding(${B.raw}) var ${out}:texture_storage_2d<${F.raw},write>;
${wgslConsts({ CACHE_TILE_SIDE, CACHE_FLAG_SKY: RADIANCE_CACHE_FLAGS.sky })}`

/** The words of a raw texel: the light, the distance word. */
const cacheRawWord = wgslFn(
  'cacheRawWord',
  [packLight],
  'fn cacheRawWord(light:vec3f,word:u32)->vec4u{return vec4u(packLight(light),word,0u,0u);}',
)

/** The light of a ray as the march through the global distance field writes it: as found, the raw texel's word rounding it to the format. */
const marchRayLight = wgslFn(
  'traceRayLight',
  [],
  'fn traceRayLight(light:vec3f,rank:u32,local:vec2u)->vec3f{return light;}',
)

/** The mean of the rays of a coarser tile, as the march through the global distance field writes it: as found. */
const marchMeanLight = wgslFn(
  'traceMeanLight',
  [],
  'fn traceMeanLight(light:vec3f,at:vec2u)->vec3f{return light;}',
)

/** Where the ray of the tile `rank` of the list, at `local` in it, is in the trace atlas: the tiles in rows of `CACHE_TRACE_ATLAS_TILES`. */
const TRACE_ATLAS_AT_WGSL = wgslBlock(
  'TRACE_ATLAS_AT_WGSL',
  [],
  `${wgslConsts({ CACHE_TRACE_ATLAS_TILES })}
fn traceAtlasAt(rank:u32,local:vec2u)->vec2u{
 return CACHE_TILE_SIDE*vec2u(rank%CACHE_TRACE_ATLAS_TILES,rank/CACHE_TRACE_ATLAS_TILES)+local;
}`,
)

/** The light of a ray of the trace through the scene's triangles, quantised as the trace atlas keeps it, dithered by a hash of its place in
 *  that atlas and of the image's turn. */
const atlasRayLight = wgslFn(
  'traceRayLight',
  [packLight, unpackLight, ditherLight, CACHE_WORDS_WGSL, TRACE_ATLAS_AT_WGSL],
  `fn traceRayLight(light:vec3f,rank:u32,local:vec2u)->vec3f{
 return unpackLight(packLight(ditherLight(light,cacheDither(traceAtlasAt(rank,local)))));
}`,
)

/** The mean of the rays of a coarser tile, as the spread of the trace atlas writes it: dithered by a hash of the texel it is written to. */
const splatMeanLight = wgslFn(
  'traceMeanLight',
  [ditherLight, CACHE_WORDS_WGSL],
  'fn traceMeanLight(light:vec3f,at:vec2u)->vec3f{return ditherLight(light,cacheDither(at));}',
)

/**
 * The tile of the list at the workgroup's rank, its probe, the level it is traced at and its place in the map, the head of both kernels
 * that walk the list (`traceTiles`, `spreadTiles`): `tail` follows with `rank`, `tile`, `queued`, `res`, `trace` (the rays a side of the level),
 * `at` (the tile's coordinates), `local` and `lane` in scope.
 */
const tileKernel = (
  name: string,
  tail: string,
) => `@compute @workgroup_size(CACHE_TILE_SIDE,CACHE_TILE_SIDE)
fn ${name}(@builtin(workgroup_id) group:vec3u,@builtin(num_workgroups) groups:vec3u,@builtin(local_invocation_index) lane:u32){
 let rank=flatIndex(group,groups,1u);
 if(rank>=min(cacheTiles.count,arrayLength(&cacheTiles.entries))){return;}
 let tile=cacheTiles.entries[rank];
 let queued=queuedProbe(tile.x&0xffffu);
 if(!queued.valid){return;}
 let res=cache.resolution;
 let trace=(res/2u)<<(tile.x>>16u);
 let at=vec2u(tile.y&0xffffu,tile.y>>16u);
 let local=vec2u(lane%CACHE_TILE_SIDE,lane/CACHE_TILE_SIDE);
${tail}
}`

/** The ray of a thread: its direction from the texel of its tile's level, cast as the probes' own rays are, the light of its hit, with its words. */
const TRACE_RAY_WGSL = wgslBlock(
  'TRACE_RAY_WGSL',
  [CACHE_WORDS_WGSL, QUEUED_PROBE_WGSL],
  `struct TileRay{seen:vec3f,word:u32,}
fn traceTileRay(queued:QueuedProbe,trace:u32,texel:vec2u,rank:u32,local:vec2u)->TileRay{
 let d=equalAreaDecode((vec2f(texel)+vec2f(0.5))/f32(trace));
 let begin=cacheMinTrace(queued.level);
 let ray=probeRay(probePosition(queued.cell,bounce.levels[queued.level].spacing),d,begin,bounce.reach.x,f32(trace),cacheNoiseOrigin(queued.cell,queued.level)+texel);
 let apart=(cache.flags&CACHE_FLAG_SKY)!=0u;
 let light=select(ray.lighting+ray.open*skyProbeRadiance(d),ray.lighting,apart);
 let seen=traceRayLight(light*bounce.reach.z,rank,local);
 let word=cacheDepthWord(ray.distance,ray.open==0.0,select(0.0,ray.open,apart),ray.front,ray.twoSided);
 return TileRay(seen,word);
}`,
)

/** The rays of a tile written to the raw atlas, the map at `base`: a tile of level zero writes its ray to the four texels it stands for, a
 *  tile of level one to one texel, a tile of level two the mean of four rays' light and the nearest of their distances. The rays are held
 *  in the workgroup's memory for the mean. */
const TILE_SPREAD_WGSL = wgslBlock(
  'TILE_SPREAD_WGSL',
  [cacheRawWord, CACHE_WORDS_WGSL],
  `var<workgroup> tileLight:array<vec3f,${CACHE_TILE_SIDE * CACHE_TILE_SIDE}>;
var<workgroup> tileWord:array<u32,${CACHE_TILE_SIDE * CACHE_TILE_SIDE}>;
fn spreadTile(base:vec2u,at:vec2u,local:vec2u,trace:u32,lane:u32,seen:vec3f,word:u32){
 let res=cache.resolution;
 let texel=at*CACHE_TILE_SIDE+local;
 if(trace<res){
  let factor=res/trace;
  for(var y=0u;y<factor;y++){
   for(var x=0u;x<factor;x++){textureStore(rawOut,base+texel*factor+vec2u(x,y),cacheRawWord(seen,word));}
  }
  return;
 }
 tileLight[lane]=seen;
 tileWord[lane]=word;
 workgroupBarrier();
 let factor=trace/res;
 let written=CACHE_TILE_SIDE/factor;
 if(all(local<vec2u(written))){
  var sum=vec3f(0.0);
  var nearest=CACHE_MAX_HIT;
  var met=false;
  var front=false;
  var twoSided=false;
  var sky=0.0;
  for(var j=0u;j<factor;j++){
   for(var i=0u;i<factor;i++){
    let rank4=(local.y*factor+j)*CACHE_TILE_SIDE+local.x*factor+i;
    let taken=tileWord[rank4];
    sum+=tileLight[rank4];
    nearest=min(nearest,cacheDepthOf(taken));
    met=met||cacheHitIs(taken);
    front=front||cacheFrontIs(taken);
    twoSided=twoSided||cacheTwoSidedIs(taken);
    sky+=cacheSkyOf(taken);
   }
  }
  let share=1.0/f32(factor*factor);
  let into=base+at*written+local;
  textureStore(rawOut,into,cacheRawWord(traceMeanLight(sum*share,into),cacheDepthWord(nearest,met,sky*share,front,twoSided)));
 }
}`,
)

/**
 * THE TRACE OF THE TILES of the probes' maps (`generateTiles`): a workgroup a tile, a thread a ray. A ray leaves its probe's
 * centre along the direction of its texel of the tile's level (`equalAreaDecode` over the level's side), from the nearest a
 * probe's ray starts at (`cacheMinTrace`: the diagonal of the probe's cell, so that no ray finds what the probe stands in), and is
 * cast as the probes' own rays are (`probeRay`: the light of the first surface it meets the surface cache's, nothing where it starts
 * inside a surface, the sky for what leaves the scene), as far as the reach of the probes.
 * The light it finds and the distance it went — from the probe —, with whether it met a surface and which side of it, are the texel's words of the
 * raw atlas (`cacheDepthWord`; with the sky kept apart, the light is the surfaces' alone and the word holds the share that left the scene): a
 * tile of level zero writes its ray to the four texels it stands for, a tile of level one one texel, a tile of level two the mean of four rays'
 * light and the nearest of their distances.
 *
 * The light is written multiplied by the pre-exposure the cache keeps it under (`bounce.reach.z`; a read divides it out, `bounce.reach.w`), so that
 * the format's range holds what the exposure range asks of it.
 *
 * Marched through the global distance field (`CACHE_TRACE_PROGRAM`) the rays are written to the raw atlas by the probe's slot, as found, the
 * raw texel's word rounding the light to its format. Cast through the scene's triangles, where the scene has acceleration structures
 * (`CACHE_TRACED_PROGRAM`, `../probeRayTracedWgsl.ts`: the cut's tables beside the cache's, the scene trace in group 1), each is written to the
 * trace atlas at the place of its tile in the list (`traceAtlasAt`), quantised as that atlas keeps it, dithered by a hash of that place and
 * the image's turn; `CACHE_SPLAT_PROGRAM` then spreads the trace atlas into the raw atlas by slot.
 */
const traceProgram = (ray: WgslDecl, traced: boolean) =>
  wgslProgram(
    `${traceDeclarations(traced ? 'traceOut' : 'rawOut')}
${tileKernel(
  'traceTiles',
  traced
    ? ` let ray=traceTileRay(queued,trace,at*CACHE_TILE_SIDE+local,rank,local);
 textureStore(traceOut,traceAtlasAt(rank,local),cacheRawWord(ray.seen,ray.word));`
    : ` let ray=traceTileRay(queued,trace,at*CACHE_TILE_SIDE+local,rank,local);
 spreadTile(cacheTileOf(queued.slot,res),at,local,trace,lane,ray.seen,ray.word);`,
)}`,
    [
      ray,
      SKY_READ_WGSL,
      skyLightReadWgsl(CACHE_TRACE_SKY_LIGHT),
      DIRECT_LIGHT_WGSL,
      bounceBindingsWgsl(0, B.grid, B.table),
      QUEUED_PROBE_WGSL,
      CACHE_WORDS_WGSL,
      cacheTileList(B.tiles, false),
      cacheRawWord,
      TRACE_RAY_WGSL,
      ...(traced
        ? [TRACE_ATLAS_AT_WGSL, atlasRayLight]
        : [marchRayLight, marchMeanLight, TILE_SPREAD_WGSL]),
    ],
  )

export const CACHE_TRACE_PROGRAM = traceProgram(probeRayWgsl(CACHE_TRACE_HIT), false)

export const CACHE_TRACED_PROGRAM = traceProgram(
  probeRayTracedWgsl(CACHE_TRACED_HIT, CACHE_TRACED_SCENE),
  true,
)

/**
 * THE SPREAD OF THE TRACE ATLAS (`spreadTiles`) into the raw atlas, after the trace through the scene's triangles: a workgroup a tile of the list, a thread a
 * ray, read from the tile's place in the trace atlas. A tile of level zero writes its ray to the four texels it stands for, a tile of
 * level one to one texel, a tile of level two the mean of four rays' light, quantised again — dithered by a hash of the texel it is written
 * to and the image's turn —, and the nearest of their distances (`spreadTile`).
 */
export const CACHE_SPLAT_PROGRAM = wgslProgram(
  `${RADIANCE_CACHE_PARAMS.wgsl}
@group(0) @binding(${S.queue}) var<storage,read> probeQueue:array<u32>;
@group(0) @binding(${S.params}) var<uniform> cache:RadianceCacheParams;
@group(0) @binding(${S.trace}) var traceAtlas:texture_2d<u32>;
@group(0) @binding(${S.raw}) var rawOut:texture_storage_2d<${F.raw},write>;
${wgslConsts({ CACHE_TILE_SIDE })}
${tileKernel(
  'spreadTiles',
  ` let taken=textureLoad(traceAtlas,vec2i(traceAtlasAt(rank,local)),0).rg;
 spreadTile(cacheTileOf(queued.slot,res),at,local,trace,lane,unpackLight(taken.x),taken.y);`,
)}`,
  [
    bounceBindingsWgsl(0, S.grid, S.table),
    QUEUED_PROBE_WGSL,
    CACHE_WORDS_WGSL,
    cacheTileList(S.tiles, false),
    unpackLight,
    TRACE_ATLAS_AT_WGSL,
    splatMeanLight,
    TILE_SPREAD_WGSL,
  ],
)
