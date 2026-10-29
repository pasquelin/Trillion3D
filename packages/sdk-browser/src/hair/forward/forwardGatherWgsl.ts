import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import {
  FORWARD_GATHER_BUCKETS,
  FORWARD_THREADS,
  FORWARD_TILE,
  FORWARD_TILE_PRIMS,
} from './forwardMath.ts'
import { FORWARD_CONSTANTS_WGSL, FORWARD_PARAMS_WGSL, forwardPacking } from './forwardCommonWgsl.ts'

/** The bindings of the gather, in group 0. */
const FORWARD_GATHER_BINDING = {
  params: 0,
  tiles: 1,
  prims: 2,
  primDepths: 3,
  outTiles: 4,
  outPrims: 5,
  work: 6,
  counters: 7,
} as const
const B = FORWARD_GATHER_BINDING
const T = FORWARD_TILE
const LIST = FORWARD_TILE_PRIMS
const BUCKETS = FORWARD_GATHER_BUCKETS

/**
 * THE GATHER OF THE LISTS: a group a tile of 32 pixels. It finds every list the binners made for its tile (they
 * hold the tile's coordinates), adds up their segments, takes room for them in whole lists of 1024 in the gathered ones (one counter of lists,
 * one of the tiles to shade, whose entry is the first list and how many), gives them the tile's coordinates and the range of depths of all its
 * lists, and writes the segments in the order of their depth, the nearest first: a bucket count of the depths between the range's ends
 * (`FORWARD_GATHER_BUCKETS` buckets), a prefix over the buckets, and each segment put in its bucket's next place. The lists it reads are
 * held to the room the binners made (`params.maxTiles`); it reads the first 1024 lists of the tile and gathers none past them.
 */
export const FORWARD_GATHER_WGSL = wgslProgram(
  `@group(0) @binding(${B.params}) var<uniform> params:ForwardParams;
@group(0) @binding(${B.tiles}) var<storage,read> tiles:array<u32>;
@group(0) @binding(${B.prims}) var<storage,read> prims:array<u32>;
@group(0) @binding(${B.primDepths}) var<storage,read> primDepths:array<u32>;
@group(0) @binding(${B.outTiles}) var<storage,read_write> outTiles:array<u32>;
@group(0) @binding(${B.outPrims}) var<storage,read_write> outPrims:array<u32>;
@group(0) @binding(${B.work}) var<storage,read_write> work:array<vec2u>;
@group(0) @binding(${B.counters}) var<storage,read_write> counters:array<atomic<u32>>;
var<workgroup> total:atomic<u32>;
var<workgroup> listed:atomic<u32>;
var<workgroup> leastDepth:atomic<u32>;
var<workgroup> greatestDepth:atomic<u32>;
var<workgroup> input:array<u32,${LIST}>;
var<workgroup> bucketStart:array<u32,${BUCKETS}>;
var<workgroup> bucketFill:array<atomic<u32>,${BUCKETS}>;
var<workgroup> gathered:vec4u;
fn bucketOf(depth:f32)->u32{
 let least=depthOf(atomicLoad(&leastDepth));
 let extent=1.0/max(depthOf(atomicLoad(&greatestDepth))-least,1e-5);
 let nearness=u32(clamp(saturate((depth-least)*extent)*${BUCKETS}.0,0.0,${BUCKETS - 1}.0));
 return ${BUCKETS - 1}u-nearness;
}
@compute @workgroup_size(${FORWARD_THREADS}) fn forwardGather(@builtin(workgroup_id) block:vec3u,@builtin(local_invocation_index) lane:u32){
 if(lane==0u){
  atomicStore(&total,0u);
  atomicStore(&listed,0u);
  atomicStore(&leastDepth,0xffffffffu);
  atomicStore(&greatestDepth,0u);
 }
 for(var b=lane;b<${BUCKETS}u;b+=THREADS){atomicStore(&bucketFill[b],0u);}
 workgroupBarrier();
 let made=min(atomicLoad(&counters[COUNTER_BINNED]),params.maxTiles);
 let coord=packCoord(block.xy);
 var mine=0u;
 for(var t=lane;t<made;t+=THREADS){
  if(tiles[t*${T.words}u+${T.coord}u]!=coord){continue;}
  mine+=tiles[t*${T.words}u+${T.count}u];
  let depths=unpack2x16float(tiles[t*${T.words}u+${T.depth}u]);
  atomicMin(&leastDepth,depthBits(depths.x));
  atomicMax(&greatestDepth,depthBits(depths.y));
  let at=atomicAdd(&listed,1u);
  if(at<${LIST}u){input[at]=t;}
 }
 if(mine>0u){atomicAdd(&total,mine);}
 workgroupBarrier();
 if(lane==0u){
  let segments=atomicLoad(&total);
  var first=0u;
  if(segments>0u){
   let lists=(segments+${LIST - 1}u)/${LIST}u;
   first=atomicAdd(&counters[COUNTER_GATHERED],lists);
   let slot=atomicAdd(&counters[COUNTER_WORK],1u);
   if(slot<arrayLength(&work)){work[slot]=vec2u(first,lists);}
   let depths=pack2x16float(vec2f(depthOf(atomicLoad(&leastDepth)),depthOf(atomicLoad(&greatestDepth))));
   for(var i=0u;i<lists;i++){
    let list=first+i;
    if(list>=params.maxTiles){break;}
    outTiles[list*${T.words}u+${T.count}u]=min(segments-i*${LIST}u,${LIST}u);
    outTiles[list*${T.words}u+${T.coord}u]=coord;
    outTiles[list*${T.words}u+${T.depth}u]=depths;
   }
  }
  gathered=vec4u(segments,first,min(atomicLoad(&listed),${LIST}u),0u);
 }
 let found=workgroupUniformLoad(&gathered);
 if(found.x==0u){return;}
 for(var i=0u;i<found.z;i++){
  let list=input[i];
  let count=tiles[list*${T.words}u+${T.count}u];
  for(var p=lane;p<count;p+=THREADS){
   atomicAdd(&bucketFill[bucketOf(depthOf(primDepths[list*${LIST}u+p]))],1u);
  }
 }
 workgroupBarrier();
 if(lane==0u){
  var running=0u;
  for(var b=0u;b<${BUCKETS}u;b++){
   bucketStart[b]=running;
   running+=atomicLoad(&bucketFill[b]);
  }
 }
 workgroupBarrier();
 for(var b=lane;b<${BUCKETS}u;b+=THREADS){atomicStore(&bucketFill[b],0u);}
 workgroupBarrier();
 for(var i=0u;i<found.z;i++){
  let list=input[i];
  let count=tiles[list*${T.words}u+${T.count}u];
  for(var p=lane;p<count;p+=THREADS){
   let b=bucketOf(depthOf(primDepths[list*${LIST}u+p]));
   let at=found.y*${LIST}u+bucketStart[b]+atomicAdd(&bucketFill[b],1u);
   if(at<arrayLength(&outPrims)){outPrims[at]=prims[list*${LIST}u+p];}
  }
 }
}`,
  [FORWARD_PARAMS_WGSL, FORWARD_CONSTANTS_WGSL, forwardPacking],
)
