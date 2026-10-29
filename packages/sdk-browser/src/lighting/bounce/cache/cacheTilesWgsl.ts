import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { wgslF32 } from '../../../../../math/src/wgsl/number.ts'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { listWgsl } from '../../../gpu/dispatch/list.ts'
import { WORKGROUP_THREADS_WGSL } from '../../../gpu/dispatch/grid.ts'
import { bounceBindingsWgsl } from '../gridWgsl.ts'
import { QUEUED_PROBE_WGSL } from '../probes/probeQueueWgsl.ts'
import { CACHE_TILES_BINDINGS as B } from './cacheBindings.ts'
import { harmonicsShader } from '../../../../../sdk-core/src/scene/core/irradianceBasis.ts'
import {
  CACHE_PDF_UNITS,
  CACHE_PDF_WORDS,
  CACHE_TILE_SIDE,
  RADIANCE_CACHE_PARAMS,
} from './cacheLayout.ts'
import { CACHE_WORDS_WGSL } from './cacheWordsWgsl.ts'

/** The list of the trace tiles at `binding`, as a kernel appends to it or reads it: an entry the queued probe, the tile's level and its
 *  coordinates. */
export const cacheTileList = (binding: number, append: boolean) =>
  listWgsl({ name: 'cacheTiles', group: 0, binding, entry: 'vec2u', append })

/** The group of tiles a sort orders among themselves, and the bins of directions it orders them by: eight along each side of the probe's map. */
const SORT_GROUP = 64
const SORT_BINS_SIDE = 8
/** The tiles of the list ordered by the direction they trace, a group of `SORT_GROUP` tiles at a time (`cacheSortTiles`): a workgroup counts the tiles in each bin of the map's
 *  directions, then each tile takes its place after the bins before its own, so that the rays of a subgroup point the same way. Run over the same dispatch as the trace, one
 *  workgroup a tile of the list: the first of each group does the group's, the others leave at once. */
const cacheSortTiles = `var<workgroup> sortCounts:array<atomic<u32>,${SORT_GROUP}>;
var<workgroup> sortOffsets:array<atomic<u32>,${SORT_GROUP}>;
fn sortBin(tile:vec2u)->u32{
 let level=tile.x>>16u;
 let coord=vec2u(tile.y&0xffffu,tile.y>>16u);
 let bin=coord*CACHE_TILE_SIDE*${SORT_BINS_SIDE}u/((cache.resolution/2u)<<level);
 return bin.y*${SORT_BINS_SIDE}u+bin.x;
}
@compute @workgroup_size(${SORT_GROUP})
fn sortTiles(@builtin(workgroup_id) group:vec3u,@builtin(num_workgroups) groups:vec3u,@builtin(local_invocation_index) lane:u32){
 let first=flatIndex(group,groups,1u);
 if(first%${SORT_GROUP}u!=0u){return;}
 let at=first+lane;
 let live=at<min(atomicLoad(&cacheTiles.count),arrayLength(&cacheTiles.entries)-1u);
 atomicStore(&sortCounts[lane],0u);
 atomicStore(&sortOffsets[lane],0u);
 workgroupBarrier();
 var tile=vec2u(0u);
 var bin=0u;
 if(live){
  tile=cacheTiles.entries[at];
  bin=sortBin(tile);
  atomicAdd(&sortCounts[bin],1u);
 }
 workgroupBarrier();
 storageBarrier();
 if(live){
  var place=atomicAdd(&sortOffsets[bin],1u);
  for(var before=0u;before<bin;before++){place+=atomicLoad(&sortCounts[before]);}
  cacheTiles.entries[first+place]=tile;
 }
}`

/** The tiles that follow the lobes the screen probes want light in. A probe's lobes are the means of the screen probes' round it (`scatterLobes`,
 *  `screen/importanceWgsl.ts`), summed in whole units in an integer atomic with the weight they were summed with (`cacheLobes`). A tile of the
 *  first level is traced at that level where no light is wanted in its direction (the lobes' value at its centre, `cacheLobeRefines`, is not above
 *  the threshold: none above zero at the first level, the setting's after), else it is cut in four tiles of the next level, as far as the probe's
 *  distance allows: one level past the downsample distance, two within it, three within the supersample distance. A thread walks the tree of
 *  the tiles of the first level it takes, a stack of its own holding the tiles to look at. */
const cacheAdaptiveTiles = `const CACHE_PDF_WORDS:u32=${CACHE_PDF_WORDS}u;
const CACHE_PDF_UNITS:f32=${wgslF32(CACHE_PDF_UNITS)};
fn cacheBasis(d:vec3f)->array<f32,9>{return ${harmonicsShader('d')};}
/** The mean of the harmonics of the lobes the screen probes asked light in, for the probe of the slot: zero where none did. */
fn cacheLobes(slot:u32)->array<f32,9>{
 let at=slot*CACHE_PDF_WORDS;
 var mean=array<f32,9>();
 let weight=f32(atomicLoad(&lobes[at+9u]));
 if(weight>0.0){
  let scale=1.0/(CACHE_PDF_UNITS*weight);
  for(var k=0u;k<9u;k++){mean[k]=f32(atomicLoad(&lobes[at+k]))*scale;}
 }
 return mean;
}
/** Whether the lobes weigh more than the threshold in the direction of the centre of the tile at coord, of perSide tiles a side of the map. */
fn cacheLobeRefines(coord:vec2u,perSide:u32,threshold:f32,mean:array<f32,9>)->bool{
 let basis=cacheBasis(equalAreaDecode((vec2f(coord)+vec2f(0.5))/f32(perSide)));
 var weight=0.0;
 for(var k=0u;k<9u;k++){weight+=mean[k]*basis[k];}
 return max(weight,0.0)>threshold;
}
/** The tiles of a probe cut by its lobes, to levels levels at the most. */
fn cacheLobeTiles(entry:u32,slot:u32,levels:u32,lane:u32){
 let first=cache.resolution/(2u*CACHE_TILE_SIDE);
 let mean=cacheLobes(slot);
 for(var t=lane;t<first*first;t+=WORKGROUP_THREADS){
  var pending=array<vec3u,12>();
  pending[0]=vec3u(t%first,t/first,0u);
  var count=1u;
  loop{
   if(count==0u){break;}
   count--;
   let node=pending[count];
   if(node.z+1u<levels&&cacheLobeRefines(node.xy,first<<node.z,select(cache.tileThreshold,0.0,node.z==0u),mean)){
    for(var child=0u;child<4u;child++){
     pending[count]=vec3u(node.xy*2u+vec2u(child&1u,child>>1u),node.z+1u);
     count++;
    }
   }else{cacheAppend(entry,node.z,node.xy);}
  }
 }
}
/** The lobes of the probes the frame queued set to nothing, before the screen probes add theirs: a workgroup a probe, a thread a word. */
@compute @workgroup_size(CACHE_PDF_WORDS)
fn clearLobes(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_index) lane:u32){
 if(group.x>=bounce.frame.y||bounce.counts.w==0u){return;}
 let queued=queuedProbe(group.x);
 if(!queued.valid){return;}
 atomicStore(&lobes[queued.slot*CACHE_PDF_WORDS+lane],0);
}
/** The tiles of the probes the frame queued, cut by the lobes the screen probes want light in: a workgroup a probe. A map under sixteen texels a side has
 *  no tile of the first level: it is the one tile of the whole side, as it is when the lobes are not followed. */
@compute @workgroup_size(CACHE_TILE_SIDE,CACHE_TILE_SIDE)
fn generateLobeTiles(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_index) lane:u32){
 let entry=group.x;
 if(entry>=bounce.frame.y||bounce.counts.w==0u){return;}
 let queued=queuedProbe(entry);
 if(!queued.valid){return;}
 if(cache.resolution<2u*CACHE_TILE_SIDE){cacheUniformTiles(entry,1u,lane);return;}
 let farness=cameraDistanceSq(cache.eye.xyz-queuedPosition(queued));
 var levels=1u;
 if(farness<cache.downsampleSq){levels=select(2u,3u,farness<cache.supersampleSq);}
 if(queued.downsampled){levels=1u;}
 cacheLobeTiles(entry,queued.slot,levels,lane);
}`

/**
 * THE TRACE TILES of the probes the frame queued: what the probes' maps are traced as. A map of `R × R` texels is cut in tiles
 * of 8 × 8 rays, a workgroup each; a tile of level `L` traces `R/2 · 2^L` rays a side, the texels it covers taking the ray of
 * theirs (the map's side at level one, half of it at level zero, each ray standing for four texels, twice it at level two, four
 * rays averaged in a texel). A probe is traced whole at one level: the setting's (`level`: one, the whole side, unless the setting
 * forces another), a probe at or past the downsample distance from the eye, or one first traced where the budget had no room
 * (`downsampled`), at level zero, one within the supersample distance at level two. The trace atlas holds the most tiles the list can hold: the tiles
 * listed past what the atlas holds (a device-sized cap) are traced in further slices (`advanceSlice`, `cacheTraceSlices`).
 */
export const CACHE_TILES_PROGRAM = wgslProgram(
  `${RADIANCE_CACHE_PARAMS.wgsl}
@group(0) @binding(${B.queue}) var<storage,read> probeQueue:array<u32>;
@group(0) @binding(${B.params}) var<uniform> cache:RadianceCacheParams;
@group(0) @binding(${B.pdf}) var<storage,read_write> lobes:array<atomic<i32>>;
${wgslConsts({ CACHE_TILE_SIDE })}
/** The tile \`c\` of \`level\` appended to the list: the probe's queue entry, the level, the coordinates. */
fn cacheAppend(entry:u32,level:u32,c:vec2u){
 let at=cacheTilesAppend(1u,1u);
 if(at<arrayLength(&cacheTiles.entries)-1u){cacheTiles.entries[at]=vec2u(entry|(level<<16u),c.x|(c.y<<16u));}
}
/** The tiles of a probe traced whole at \`level\`; a map too small for a tile at that level (under sixteen texels a side) is one tile of the whole side. */
fn cacheUniformTiles(entry:u32,level:u32,lane:u32){
 var perSide=(cache.resolution/(2u*CACHE_TILE_SIDE))<<level;
 var traced=level;
 if(perSide==0u){perSide=1u;traced=1u;}
 for(var t=lane;t<perSide*perSide;t+=WORKGROUP_THREADS){cacheAppend(entry,traced,vec2u(t%perSide,t/perSide));}
}
/** The tiles of the probes the frame queued, a workgroup a probe. */
@compute @workgroup_size(CACHE_TILE_SIDE,CACHE_TILE_SIDE)
fn generateTiles(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_index) lane:u32){
 let entry=group.x;
 if(entry>=bounce.frame.y||bounce.counts.w==0u){return;}
 let queued=queuedProbe(entry);
 if(!queued.valid){return;}
 let farness=cameraDistanceSq(cache.eye.xyz-queuedPosition(queued));
 var level=cache.level;
 if(farness>=cache.downsampleSq){level=0u;}
 else if(farness<cache.supersampleSq){level=2u;}
 if(queued.downsampled){level=0u;}
 cacheUniformTiles(entry,level,lane);
}
/** The next slice of the list: the first tile of the slice, kept in the list's last cell, moves on by the tiles the trace atlas holds. */
@compute @workgroup_size(1)
fn advanceSlice(){
 let last=arrayLength(&cacheTiles.entries)-1u;
 cacheTiles.entries[last].x+=cache.traceTiles;
}
${cacheSortTiles}
${cacheAdaptiveTiles}`,
  [
    bounceBindingsWgsl(0, B.grid, B.table),
    QUEUED_PROBE_WGSL,
    CACHE_WORDS_WGSL,
    cacheTileList(B.tiles, true),
    WORKGROUP_THREADS_WGSL,
  ],
)
