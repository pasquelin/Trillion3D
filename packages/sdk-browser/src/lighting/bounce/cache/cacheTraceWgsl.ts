import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { packLight } from '../../../gpu/core/smallFloatWgsl.ts'
import { DIRECT_LIGHT_WGSL } from '../../direct/lightWgsl.ts'
import { bounceBindingsWgsl } from '../gridWgsl.ts'
import { QUEUED_PROBE_WGSL } from '../probes/probeQueueWgsl.ts'
import { probeRayWgsl } from '../probeRayWgsl.ts'
import { SKY_READ_WGSL } from '../../atmosphere/skyReadWgsl.ts'
import { skyLightReadWgsl } from '../../../modules/sky/skyLight/read.ts'
import {
  CACHE_TRACE_BINDINGS as B,
  CACHE_TRACE_HIT,
  CACHE_TRACE_SKY_LIGHT,
} from './cacheBindings.ts'
import { cacheTileList } from './cacheTilesWgsl.ts'
import {
  CACHE_TILE_SIDE,
  RADIANCE_CACHE_FLAGS,
  RADIANCE_CACHE_FORMATS as F,
  RADIANCE_CACHE_PARAMS,
} from './cacheLayout.ts'
import { CACHE_WORDS_WGSL } from './cacheWordsWgsl.ts'

/**
 * THE TRACE OF THE TILES of the probes' maps (`generateTiles`): a workgroup a tile, a thread a ray. A ray leaves its probe's
 * centre along the direction of its texel of the tile's level (`equalAreaDecode` over the level's side), from the nearest a
 * probe's ray starts at (`cacheMinTrace`: the diagonal of the probe's cell, so that no ray finds what the probe stands in), and is
 * marched through the global distance field as the probes' own rays are (`probeRay`: the light of the first surface it meets the
 * surface cache's, nothing where it starts inside a surface, the sky for what leaves the scene), as far as the reach of the probes.
 * The light it finds and the distance it went — from the probe —, with whether it met a surface, are the texel's words of the raw atlas
 * (`cacheDepthWord`; with the sky kept apart, the light is the surfaces' alone and the word holds the share that left the scene): a tile of level zero writes its ray to the four texels it stands for, a tile of level one one texel, a
 * tile of level two the mean of four rays' light and the nearest of their distances.
 */
export const CACHE_TRACE_PROGRAM = wgslProgram(
  `${RADIANCE_CACHE_PARAMS.wgsl}
@group(0) @binding(${B.lights}) var<storage,read> directLights:DirectLights;
@group(0) @binding(${B.queue}) var<storage,read> probeQueue:array<u32>;
@group(0) @binding(${B.params}) var<uniform> cache:RadianceCacheParams;
@group(0) @binding(${B.raw}) var rawOut:texture_storage_2d<${F.raw},write>;
${wgslConsts({ CACHE_TILE_SIDE, CACHE_FLAG_SKY: RADIANCE_CACHE_FLAGS.sky })}
var<workgroup> tileLight:array<vec3f,${CACHE_TILE_SIDE * CACHE_TILE_SIDE}>;
var<workgroup> tileWord:array<u32,${CACHE_TILE_SIDE * CACHE_TILE_SIDE}>;
/** The words of a raw texel: the light, the distance word. */
fn cacheRawWord(light:vec3f,word:u32)->vec4u{return vec4u(packLight(light),word,0u,0u);}
@compute @workgroup_size(CACHE_TILE_SIDE,CACHE_TILE_SIDE)
fn traceTiles(@builtin(workgroup_id) group:vec3u,@builtin(num_workgroups) groups:vec3u,@builtin(local_invocation_index) lane:u32){
 let rank=flatIndex(group,groups,1u);
 if(rank>=min(cacheTiles.count,arrayLength(&cacheTiles.entries))){return;}
 let tile=cacheTiles.entries[rank];
 let queued=queuedProbe(tile.x&0xffffu);
 if(!queued.valid){return;}
 let res=cache.size.x;
 let trace=(res/2u)<<(tile.x>>16u);
 let at=vec2u(tile.y&0xffffu,tile.y>>16u);
 let local=vec2u(lane%CACHE_TILE_SIDE,lane/CACHE_TILE_SIDE);
 let texel=at*CACHE_TILE_SIDE+local;
 let d=equalAreaDecode((vec2f(texel)+vec2f(0.5))/f32(trace));
 let base=cacheTileOf(queued.slot,res);
 let begin=cacheMinTrace(queued.level);
 let ray=probeRay(probeCentre(queued.cell,bounce.levels[queued.level].spacing),d,begin,bounce.reach.x,f32(trace),cacheNoiseOrigin(queued.cell,queued.level)+texel);
 let apart=(cache.size.y&CACHE_FLAG_SKY)!=0u;
 let seen=select(ray.lighting+ray.open*skyProbeRadiance(d),ray.lighting,apart);
 let word=cacheDepthWord(ray.distance,ray.open==0.0,select(0.0,ray.open,apart));
 if(trace<res){
  let factor=res/trace;
  for(var y=0u;y<factor;y++){
   for(var x=0u;x<factor;x++){textureStore(rawOut,base+texel*factor+vec2u(x,y),cacheRawWord(seen,word));}
  }
  return;
 }
 if(trace==res){
  textureStore(rawOut,base+texel,cacheRawWord(seen,word));
  return;
 }
 tileLight[lane]=seen;
 tileWord[lane]=word;
 workgroupBarrier();
 if(all(local<vec2u(CACHE_TILE_SIDE/2u))){
  var sum=vec3f(0.0);
  var nearest=CACHE_MAX_HIT;
  var met=false;
  var sky=0.0;
  for(var j=0u;j<2u;j++){
   for(var i=0u;i<2u;i++){
    let rank4=(local.y*2u+j)*CACHE_TILE_SIDE+local.x*2u+i;
    sum+=tileLight[rank4];
    nearest=min(nearest,cacheDepthOf(tileWord[rank4]));
    met=met||cacheHitIs(tileWord[rank4]);
    sky+=cacheSkyOf(tileWord[rank4]);
   }
  }
  textureStore(rawOut,base+at*(CACHE_TILE_SIDE/2u)+local,cacheRawWord(sum*0.25,cacheDepthWord(nearest,met,sky*0.25)));
 }
}`,
  [
    probeRayWgsl(CACHE_TRACE_HIT),
    SKY_READ_WGSL,
    skyLightReadWgsl(CACHE_TRACE_SKY_LIGHT),
    DIRECT_LIGHT_WGSL,
    bounceBindingsWgsl(0, B.grid, B.table),
    QUEUED_PROBE_WGSL,
    CACHE_WORDS_WGSL,
    cacheTileList(B.tiles, false),
    packLight,
  ],
)
