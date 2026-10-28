import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { FLAT_INDEX_WGSL, GROUP_GRID_WGSL } from '../gpu/dispatch/grid.ts'
import { HAIR_BAND_WGSL, HAIR_IMAGE_WGSL } from './imageBlock.ts'
import { hairTilePixel } from './tilesWgsl.ts'
import {
  HAIR_COORD_BITS,
  HAIR_COVERAGE_BITS,
  HAIR_COVERAGE_FORMAT,
  HAIR_COVERAGE_STEPS,
  HAIR_DEPTH_SCALE,
  HAIR_DISPATCH_ARGS_WORDS,
  HAIR_NODE_COUNTER_PLACED,
  HAIR_NODE_COUNTER_STORED,
  HAIR_NODE_COUNTERS,
  HAIR_NODE_GROUP_SIZE,
  HAIR_NODE_INDEX_FORMAT,
  HAIR_NODE_OFFSET_BITS,
  HAIR_NODE_OFFSET_MASK,
  HAIR_TILE_ALL,
  HAIR_TILE_LISTS,
  HAIR_TILE_SIZE,
  HAIR_TRANSMITTANCE_FORMAT,
  type HairSampleCount,
} from './visibilityMath.ts'

/** The bindings of the compaction kernel and the sample count. */
const compactBindingsText = (samples: HairSampleCount, read: string) => `const SAMPLES=${samples}u;
@group(0) @binding(1) var sceneDepth:texture_depth_2d;
@group(0) @binding(2) var transmittance:texture_storage_2d<${HAIR_TRANSMITTANCE_FORMAT},read>;
${read}
@group(0) @binding(4) var<storage,read> counts:array<u32,${HAIR_TILE_LISTS}>;
@group(0) @binding(5) var<storage,read> tiles:array<u32>;
@group(0) @binding(6) var<storage,read_write> nodeCounter:array<atomic<u32>,${HAIR_NODE_COUNTERS}>;
@group(0) @binding(7) var nodeIndex:texture_storage_2d<${HAIR_NODE_INDEX_FORMAT},write>;
@group(0) @binding(8) var coverageOut:texture_storage_2d<${HAIR_COVERAGE_FORMAT},write>;
@group(0) @binding(9) var<storage,read_write> nodeVis:array<vec2u>;
@group(0) @binding(10) var<storage,read_write> nodeCoord:array<u32>;
@group(0) @binding(11) var<uniform> band:HairBand;`

/** The kernel's head: the samples of a pixel found, counted and given their place. */
const compactFindText = (samples: HairSampleCount) => `struct Found{id:u32,count:u32,depth:u32}
var<workgroup> allocCount:atomic<u32>;
var<workgroup> allocBase:u32;
var<workgroup> allocFits:u32;
@compute @workgroup_size(${HAIR_TILE_SIZE},${HAIR_TILE_SIZE},1) fn hairCompact(@builtin(workgroup_id) block:vec3u,@builtin(num_workgroups) blocks:vec3u,@builtin(local_invocation_id) local:vec3u,@builtin(local_invocation_index) lane:u32){
 if(lane==0u){atomicStore(&allocCount,0u);}
 workgroupBarrier();
 let rank=flatIndex(block,blocks,1u);
 let listed=rank<counts[${HAIR_TILE_ALL}];
 let tile=tiles[${HAIR_TILE_ALL}u*image.capacity+min(rank,image.capacity-1u)];
 let pixel=hairTilePixel(tile,local.xy);
 let valid=listed&&all(pixel<image.size)&&pixel.y>=band.first&&pixel.y<band.end;
 var found:array<Found,${samples}>;
 var foundCount=0u;
 var validCount=0u;
 if(valid){
  let opaque=textureLoad(sceneDepth,vec2i(pixel),0);
  let base=((pixel.y-band.first)*image.size.x+pixel.x)*SAMPLES;
  for(var s=0u;s<SAMPLES;s++){
   let hit=readSample(base+s);
   if(hit.y==0u){continue;}
   if(opaque>bitcast<f32>(hit.y)){continue;}
   validCount++;
   var known=false;
   for(var f=0u;f<foundCount;f++){
    if(found[f].id==hit.x){
     found[f].count++;
     if(hit.y>found[f].depth){found[f].depth=hit.y;}
     known=true;
     break;
    }
   }
   if(!known){
    found[foundCount]=Found(hit.x,1u,hit.y);
    foundCount++;
   }
  }`

/** The kernel's tail: the samples sorted by depth where asked, then written with the pixel's descriptor and coverage. */
const compactWriteText = `  if(image.sortByDepth!=0u){
   for(var i=0u;i<foundCount;i++){
    for(var j=i+1u;j<foundCount;j++){
     if(found[j].depth>found[i].depth){
      let swap=found[i];
      found[i]=found[j];
      found[j]=swap;
     }
    }
   }
  }
 }
 var place=0u;
 if(foundCount>0u){place=atomicAdd(&allocCount,foundCount);}
 workgroupBarrier();
 if(lane==0u){
  let total=atomicLoad(&allocCount);
  allocBase=0u;
  allocFits=0u;
  if(total>0u){
   allocBase=atomicAdd(&nodeCounter[${HAIR_NODE_COUNTER_PLACED}],total);
   if(allocBase+total<=image.maxNodes){
    atomicAdd(&nodeCounter[${HAIR_NODE_COUNTER_STORED}],total);
    allocFits=1u;
   }
  }
 }
 workgroupBarrier();
 if(!valid){return;}
 let offset=allocBase+place;
 var stored=0u;
 var coverage=0.0;
 if(foundCount>0u&&allocFits!=0u){
  for(var n=0u;n<foundCount;n++){
   let depth=u32(bitcast<f32>(found[n].depth)*${HAIR_DEPTH_SCALE}.0);
   let share=min(found[n].count*${HAIR_COVERAGE_STEPS}u/validCount,${HAIR_COVERAGE_STEPS - 1}u);
   nodeVis[offset+n]=vec2u((depth<<${HAIR_COVERAGE_BITS}u)|share,found[n].id);
   nodeCoord[offset+n]=pixel.x|(pixel.y<<${HAIR_COORD_BITS}u);
  }
  stored=foundCount;
  coverage=saturate(min(1.0-textureLoad(transmittance,vec2i(pixel)).r,1.0)/image.fullCoverage);
 }
 let first=select(0u,offset,stored>0u);
 textureStore(nodeIndex,vec2i(pixel),vec4u((first&${HAIR_NODE_OFFSET_MASK}u)|(stored<<${HAIR_NODE_OFFSET_BITS}u),0u,0u,0u));
 textureStore(coverageOut,vec2i(pixel),vec4f(coverage,0.0,0.0,0.0));
}`

/**
 * THE COMPACTION: for each pixel of the tiles with any strand, the strands its samples hold, as the
 * list of the distinct ones. A sample counts when it holds a strand and is not behind the opaque
 * depth (strictly farther); strands with the same identifier (a segment of a group) are one, with
 * the count of samples that hold it and the nearest of their depths; with `sortByDepth` the list goes
 * from the nearest. The pixel's list is placed in the list of all the pixels by the workgroup, which
 * adds its pixels' counts to the shared counter once and hands each pixel its place; a workgroup
 * whose lists do not all fit in the room (`maxNodes`) stores none of them, its pixels with none and no
 * coverage. The samples stored are therefore the first of the room, whole (`HAIR_NODE_COUNTER_STORED`
 * counts them), however many the pixels asked for (`HAIR_NODE_COUNTER_PLACED`).
 *
 * What it writes: for each pixel, the descriptor of its list (the place of its first sample on 26
 * bits, how many on 6), and its coverage, the transmittance's share of the full coverage; for each
 * sample, its depth (24 bits) and its share of the pixel's samples (8 bits, a whole number of
 * 256ths) in a word, its identifier in the other, and its pixel.
 *
 * The samples lie in bands of rows, one buffer each (`HAIR_BAND_WGSL`): a dispatch is one band's, over
 * all the tiles, and takes none of the tiles outside its rows.
 */
export function compactWgsl(samples: HairSampleCount, wide: boolean) {
  const read = wide
    ? `@group(0) @binding(3) var<storage,read> samples:array<vec2u>;
fn readSample(index:u32)->vec2u{return samples[index];}`
    : `@group(0) @binding(3) var<storage,read> samples:array<u32>;
fn readSample(index:u32)->vec2u{return vec2u(samples[band.plane+index],samples[index]);}`
  return wgslProgram(
    `${compactBindingsText(samples, read)}\n${compactFindText(samples)}\n${compactWriteText}`,
    [HAIR_IMAGE_WGSL, HAIR_BAND_WGSL, hairTilePixel, FLAT_INDEX_WGSL],
  )
}

/**
 * The dispatch over the compacted samples, one group of `HAIR_NODE_GROUP_SIZE` threads for each that
 * was stored: a row of groups when they are few, else as many rows as it takes (`groupGrid`).
 */
export const NODE_ARGS_WGSL = wgslProgram(
  `@group(0) @binding(0) var<storage,read> nodeCounter:array<u32,${HAIR_NODE_COUNTERS}>;
@group(0) @binding(1) var<storage,read_write> nodeArgs:array<u32,${HAIR_DISPATCH_ARGS_WORDS}>;
@compute @workgroup_size(1) fn hairNodeArgs(){
 let groups=groupGrid(ceilDiv(nodeCounter[${HAIR_NODE_COUNTER_STORED}],${HAIR_NODE_GROUP_SIZE}u));
 nodeArgs[0]=groups.x;
 nodeArgs[1]=groups.y;
 nodeArgs[2]=1u;
}`,
  [GROUP_GRID_WGSL],
)
