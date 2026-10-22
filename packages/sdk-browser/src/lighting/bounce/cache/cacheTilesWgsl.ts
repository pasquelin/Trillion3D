import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslF32 } from '../../../../../math/src/wgsl/number.ts'
import { harmonicsShader } from '../../../../../sdk-core/src/scene/core/irradianceBasis.ts'
import { SCREEN_PROBE_CONSTANTS } from '../../../../../sdk-core/src/bounce/screenProbeLevels.ts'
import { listWgsl } from '../../../gpu/dispatch/list.ts'
import { WORKGROUP_THREADS, WORKGROUP_THREADS_WGSL } from '../../../gpu/dispatch/grid.ts'
import { bounceBindingsWgsl } from '../gridWgsl.ts'
import { QUEUED_PROBE_WGSL } from '../probes/probeQueueWgsl.ts'
import { CACHE_TILES_BINDINGS as B } from './cacheBindings.ts'
import {
  CACHE_PDF_WORDS,
  CACHE_TILE_SIDE,
  RADIANCE_CACHE_FLAGS,
  RADIANCE_CACHE_PARAMS,
  RADIANCE_CACHE_TILE_MODES,
} from './cacheLayout.ts'
import { CACHE_WORDS_WGSL } from './cacheWordsWgsl.ts'

/** The list of the trace tiles at `binding`, as a kernel appends to it or reads it: an entry the queued probe, the tile's level and its
 *  coordinates. */
export const cacheTileList = (binding: number, append: boolean) =>
  listWgsl({ name: 'cacheTiles', group: 0, binding, entry: 'vec2u', append })

/**
 * THE TRACE TILES of the probes the frame queued: what the probes' maps are traced as. A map of `R × R` texels is cut in tiles
 * of 8 × 8 rays, a workgroup each; a tile of level `L` traces `R/2 · 2^L` rays a side, the texels it covers taking the ray of
 * theirs (the map's side at level one, half of it at level zero, each ray standing for four texels, twice it at level two, four
 * rays averaged in a texel). A probe within `downsample` distance of the eye is traced at level one where the pixels' lobes
 * reach, level zero elsewhere: the tile of level zero is refined into four of level one where the importance function — the
 * cosine lobes of the screen probes that read the probe, summed into it (`scatterPdf`) — is above zero in its direction, and,
 * within the supersample distance, a tile of level one into four where it is above the threshold. Without the pixels' lobes a probe is
 * traced whole at one level (the mode of the setting, the frame's default where it is `adaptive`): and a probe past the downsample
 * distance, or one first traced where the budget had no room (`downsampled`), at level zero, one within the supersample distance
 * at level two (`size.w` is the level of an `adaptive` probe the pixels' lobes do not reach). A probe that sleeps (its cell unchanged, nothing lit moved since) is not traced: its flag stays down
 * (`cacheEntries`). A probe's importance function is cleared before the screen probes add to it (`clearPdf`).
 */
export const CACHE_TILES_PROGRAM = wgslProgram(
  `${RADIANCE_CACHE_PARAMS.wgsl}
@group(0) @binding(${B.queue}) var<storage,read> probeQueue:array<u32>;
@group(0) @binding(${B.params}) var<uniform> cache:RadianceCacheParams;
@group(0) @binding(${B.pdf}) var<storage,read_write> cachePdf:array<atomic<i32>>;
@group(0) @binding(${B.entries}) var<storage,read_write> cacheEntries:array<u32>;
${wgslConsts({
  CACHE_PDF_WORDS,
  CACHE_TILE_SIDE,
  CACHE_FLAG_IMPORTANCE: RADIANCE_CACHE_FLAGS.importance,
  CACHE_MODE_ADAPTIVE: RADIANCE_CACHE_TILE_MODES.adaptive,
  CACHE_MODE_HALF: RADIANCE_CACHE_TILE_MODES.half,
  CACHE_MODE_FULL: RADIANCE_CACHE_TILE_MODES.full,
  CACHE_MODE_SUPERSAMPLED: RADIANCE_CACHE_TILE_MODES.supersampled,
})}
const CACHE_PDF_SCALE:f32=${wgslF32(1 / SCREEN_PROBE_CONSTANTS.radiancePdfScale)};
/** The probability of direction \`d\` of the probe in slot \`slot\`: the mean of the cosine lobes the screen probes added, read
 *  along it, never negative; zero where none added any. */
fn cachePdfAt(slot:u32,d:vec3f)->f32{
 let at=slot*CACHE_PDF_WORDS;
 let count=f32(atomicLoad(&cachePdf[at+9u]));
 if(count<=0.0){return 0.0;}
 let basis=${harmonicsShader('d')};
 var sum=0.0;
 for(var k=0u;k<9u;k++){sum+=f32(atomicLoad(&cachePdf[at+k]))*basis[k];}
 return max(sum*CACHE_PDF_SCALE/count,0.0);
}
/** Whether the tile \`c\` of \`level\`, of \`perSide\` tiles a side, is refined into four of the next level. */
fn cacheRefined(slot:u32,level:u32,c:vec2u,perSide:u32)->bool{
 let d=equalAreaDecode((vec2f(c)+vec2f(0.5))/f32(perSide));
 return cachePdfAt(slot,d)>select(cache.distances.z,0.0,level==0u);
}
/** The tile \`c\` of \`level\` appended to the list: the probe's queue entry, the level, the coordinates. */
fn cacheAppend(entry:u32,level:u32,c:vec2u){
 let at=cacheTilesAppend(1u,1u);
 if(at<arrayLength(&cacheTiles.entries)){cacheTiles.entries[at]=vec2u(entry|(level<<16u),c.x|(c.y<<16u));}
}
/** The importance functions of the probes the frame queued, cleared: a thread a word. */
@compute @workgroup_size(WORKGROUP_THREADS)
fn clearPdf(@builtin(global_invocation_id) id:vec3u){
 let entry=id.x/CACHE_PDF_WORDS;
 if(entry>=bounce.frame.y||bounce.counts.w==0u){return;}
 let queued=queuedProbe(entry);
 if(!queued.valid){return;}
 atomicStore(&cachePdf[queued.slot*CACHE_PDF_WORDS+id.x%CACHE_PDF_WORDS],0);
}
/** The tiles of a probe traced whole at \`level\`. */
fn cacheUniformTiles(entry:u32,level:u32,lane:u32){
 let perSide=(cache.size.x/(2u*CACHE_TILE_SIDE))<<level;
 for(var t=lane;t<perSide*perSide;t+=WORKGROUP_THREADS){cacheAppend(entry,level,vec2u(t%perSide,t/perSide));}
}
/** The tiles of a probe cut by the pixels' lobes, in \`levels\` levels: a tile of a level is traced where it, and not its parent, is not refined. */
fn cacheAdaptiveTiles(entry:u32,slot:u32,levels:u32,lane:u32){
 for(var level=0u;level<levels;level++){
  let perSide=(cache.size.x/(2u*CACHE_TILE_SIDE))<<level;
  for(var t=lane;t<perSide*perSide;t+=WORKGROUP_THREADS){
   let c=vec2u(t%perSide,t/perSide);
   var reached=true;
   for(var above=0u;above<level;above++){
    let shift=level-above;
    reached=reached&&cacheRefined(slot,above,c>>vec2u(shift),perSide>>shift);
   }
   if(reached&&!(level+1u<levels&&cacheRefined(slot,level,c,perSide))){cacheAppend(entry,level,c);}
  }
 }
}
/** The tiles of the probes the frame queued, a workgroup a probe. */
@compute @workgroup_size(CACHE_TILE_SIDE,CACHE_TILE_SIDE)
fn generateTiles(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_index) lane:u32){
 let entry=group.x;
 if(entry>=bounce.frame.y||bounce.counts.w==0u){return;}
 let queued=queuedProbe(entry);
 if(!queued.valid){return;}
 if(lane==0u){cacheEntries[entry]=0u;}
 let held=!queued.fresh&&all(probeCell(queued.probe)==queued.cell)&&probeLevel(queued.probe)==queued.level;
 if(held&&probeAt(queued.probe,PROBE_IDLE).w==f32(bounce.frame.x)){return;}
 let away=probeCentre(queued.cell,bounce.levels[queued.level].spacing)-cache.eye.xyz;
 let farness=dot(away,away);
 let mode=cache.size.z;
 let pixels=(cache.size.y&CACHE_FLAG_IMPORTANCE)!=0u&&mode==CACHE_MODE_ADAPTIVE;
 if(lane==0u){cacheEntries[entry]=1u;}
 if(pixels){
  var levels=1u;
  if(farness<cache.distances.x&&!queued.downsampled){levels=select(2u,3u,farness<cache.distances.y);}
  cacheAdaptiveTiles(entry,queued.slot,levels,lane);
  return;
 }
 var level=cache.size.w;
 if(mode==CACHE_MODE_HALF){level=0u;}
 else if(mode==CACHE_MODE_FULL){level=1u;}
 else if(mode==CACHE_MODE_SUPERSAMPLED){level=2u;}
 if(farness>=cache.distances.x){level=0u;}
 else if(farness<cache.distances.y){level=2u;}
 if(queued.downsampled){level=0u;}
 cacheUniformTiles(entry,level,lane);
}`,
  [
    bounceBindingsWgsl(0, B.grid, B.probes),
    QUEUED_PROBE_WGSL,
    CACHE_WORDS_WGSL,
    cacheTileList(B.tiles, true),
    WORKGROUP_THREADS_WGSL,
  ],
)

/** The workgroups of the clear for `probes` queued probes: a thread a word of a probe's importance function. */
export const clearGroups = (probes: number) => ceilDiv(probes * CACHE_PDF_WORDS, WORKGROUP_THREADS)
