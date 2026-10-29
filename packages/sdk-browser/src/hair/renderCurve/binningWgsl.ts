import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { gridWalkAdvance } from '../gridWalkWgsl.ts'
import {
  RENDER_CURVE_CLUSTER_WGSL,
  RENDER_CURVE_COLOR_WGSL,
  RENDER_CURVE_COUNTER,
  RENDER_CURVE_INSTANCE_WGSL,
  RENDER_CURVE_PARAMS_WGSL,
  RENDER_CURVE_SEGMENT_WGSL,
  RENDER_CURVE_TILE_PACK_WGSL,
} from './paramsWgsl.ts'
import { RENDER_CURVE_DDA_MAX_STEPS, RENDER_CURVE_PROJECT_WGSL } from './projectWgsl.ts'
import {
  RENDER_CURVE_BIN_TILE_SIZE,
  RENDER_CURVE_BINNER_LAYERS,
  RENDER_CURVE_CURVES_PER_CLUSTER,
  RENDER_CURVE_ENTRY_WORDS,
  RENDER_CURVE_MAX_POINTS_PER_CURVE,
  RENDER_CURVE_SEGMENTS_PER_ENTRY,
} from './renderCurveMath.ts'

/** The invocations of a binner's group: a batch of segments is this many, and a cluster is binned in as many batches as it takes. */
export const RENDER_CURVE_BIN_LANES = 256
/** The clusters a binner takes at most, and the tiles a batch asks entries of at most. */
const MAX_CLUSTER_ROUNDS = 4096
const MAX_TILES_TO_ALLOCATE = 1024
/** The entry's words: the segments it holds, its tile, and the index of the first segment of its tile it takes. */
export const RENDER_CURVE_ENTRY = { primCount: 0, coord: 1, minWrite: 2 } as const
/** The tile index a refused tile is given instead of an entry. */
const NO_ENTRY = 0xffff
const BATCHES =
  (RENDER_CURVE_CURVES_PER_CLUSTER * RENDER_CURVE_MAX_POINTS_PER_CURVE) / RENDER_CURVE_BIN_LANES
const COUNTER = RENDER_CURVE_COUNTER
const ENTRY = RENDER_CURVE_ENTRY

/** The index of layer `layer` of binner `binner` at `tile` in the buffer `tileSegments` (the layers of a binner: segments counted, segments written, tile info, first index of a refused tile). */
export const RENDER_CURVE_TILE_LAYER_WGSL = wgslBlock(
  'RENDER_CURVE_TILE_LAYER_WGSL',
  [RENDER_CURVE_PARAMS_WGSL],
  `fn layerAt(binner:u32,layer:u32,tile:vec2u)->u32{
 return ((binner*${RENDER_CURVE_BINNER_LAYERS}u+layer)*curve.binTileRes.y+tile.y)*curve.binTileRes.x+tile.x;
}`,
)

/**
 * THE BINNING OF THE SEGMENTS: a group a binner, which takes clusters from the queue of the visible ones until it is empty. A
 * cluster is cut into batches of segments, a segment an invocation (the curve is the lane over 64, the point the rest and the batch):
 * each segment is projected, clipped to the view, and walked through the bin tiles it crosses, those where it lies in front of the
 * furthest depth of the scene. A tile counts the segments of the binner; each 1024th opens an entry of the tile data (the first
 * one's tile, the first segment index it takes); then every segment is written in the entry its index falls in. A tile that
 * has no entry left is refused: its segments are left out, and the tile's earlier entry keeps its own. Group 0: the shared block (0),
 * the instances (1), the clusters (2), the visible clusters (3), the counters (4), the tile counts (5), the tile data (6), the
 * segments (7), the scene's depth per tile (8).
 */
export const RENDER_CURVE_BINNING_WGSL = wgslProgram(
  `@group(0) @binding(0) var<uniform> curve:RenderCurveParams;
@group(0) @binding(1) var<storage,read> instances:array<u32>;
@group(0) @binding(2) var<storage,read> clusterData:array<u32>;
@group(0) @binding(3) var<storage,read> visibleClusters:array<vec2u>;
@group(0) @binding(4) var<storage,read_write> counters:array<atomic<u32>>;
@group(0) @binding(5) var<storage,read_write> tileSegments:array<atomic<u32>>;
@group(0) @binding(6) var<storage,read_write> tileData:array<u32>;
@group(0) @binding(7) var<storage,read_write> segmentData:array<vec4u>;
@group(0) @binding(8) var sceneTileDepth:texture_2d<u32>;
var<workgroup> toAllocate:array<u32,${MAX_TILES_TO_ALLOCATE}>;
var<workgroup> toAllocateCount:atomic<u32>;
var<workgroup> takenActive:u32;
var<workgroup> takenCluster:u32;
var<workgroup> takenToClip:mat4x4f;
fn tileAt(coord:vec2f)->vec2u{
 return vec2u(clamp(vec2i(floor(coord)),vec2i(0),vec2i(curve.binTileRes)-vec2i(1)));
}
fn tileNearest(tile:vec2u)->f32{return bitcast<f32>(textureLoad(sceneTileDepth,vec2i(tile),0).x);}
fn binBatch(binner:u32,lane:u32,batch:u32,cluster:u32,toClip:mat4x4f){
 let header=loadClusterHeader(cluster);
 let curveIndex=lane%${RENDER_CURVE_CURVES_PER_CLUSTER}u;
 let row=lane/${RENDER_CURVE_CURVES_PER_CLUSTER}u+batch*${RENDER_CURVE_BIN_LANES / RENDER_CURVE_CURVES_PER_CLUSTER}u;
 var valid=false;
 var sp0=vec3f(0.0);
 var sp1=vec3f(0.0);
 if(curveIndex<header.curveCount&&row+1u<header.pointsPerCurve){
  let a=loadCurvePoint(header,cluster,curveIndex,row);
  let b=loadCurvePoint(header,cluster,curveIndex,row+1u);
  if(a.valid&&b.valid){
   var c0=toClip*vec4f(a.position,1.0);
   var c1=toClip*vec4f(b.position,1.0);
   valid=blinnClip(&c0,&c1);
   // A point on the edge of the view must not name the tile past the last one.
   let top=vec2f(curve.resolution)-vec2f(0.001);
   sp0=toPixel(c0);
   sp1=toPixel(c1);
   sp0=vec3f(clamp(sp0.xy,vec2f(0.0),top),sp0.z);
   sp1=vec3f(clamp(sp1.xy,vec2f(0.0),top),sp1.z);
  }
 }
 if(lane==0u){atomicStore(&toAllocateCount,0u);}
 workgroupBarrier();
 let nearestZ=min(sp0.z,sp1.z);
 let first=sp0.xy/${RENDER_CURVE_BIN_TILE_SIZE}.0;
 let last=sp1.xy/${RENDER_CURVE_BIN_TILE_SIZE}.0;
 let end=tileAt(last);
 if(valid){
  var dda=ddaCreate(first,last);
  for(var walk=0u;walk<${RENDER_CURVE_DDA_MAX_STEPS}u;walk++){
   let tile=tileAt(dda.coord);
   if(nearestZ>=tileNearest(tile)){
    let old=atomicAdd(&tileSegments[layerAt(binner,0u,tile)],1u);
    if(old%${RENDER_CURVE_SEGMENTS_PER_ENTRY}u==0u){
     let at=atomicAdd(&toAllocateCount,1u);
     if(at<${MAX_TILES_TO_ALLOCATE}u){toAllocate[at]=packTile(tile);}
    }
   }
   if(all(tile==end)){break;}
   gridWalkAdvance(&dda.coord,&dda.side,dda.delta,dda.step);
  }
 }
 workgroupBarrier();
 let allocations=min(atomicLoad(&toAllocateCount),${MAX_TILES_TO_ALLOCATE}u);
 for(var i=lane;i<allocations;i+=${RENDER_CURVE_BIN_LANES}u){
  let packed=toAllocate[i];
  let tile=unpackTile(packed);
  let totalNew=atomicLoad(&tileSegments[layerAt(binner,0u,tile)]);
  let totalOld=atomicLoad(&tileSegments[layerAt(binner,1u,tile)]);
  let entry=atomicAdd(&counters[${COUNTER.tileData}],1u);
  let info=layerAt(binner,2u,tile);
  let previous=atomicLoad(&tileSegments[info])&0xFFFFu;
  let fits=entry<curve.maxTileAllocCount;
  if(totalOld>0u&&previous!=${NO_ENTRY}u){tileData[previous*${RENDER_CURVE_ENTRY_WORDS}u+${ENTRY.primCount}u]=${RENDER_CURVE_SEGMENTS_PER_ENTRY}u;}
  if(fits){
   tileData[entry*${RENDER_CURVE_ENTRY_WORDS}u+${ENTRY.coord}u]=packed;
   tileData[entry*${RENDER_CURVE_ENTRY_WORDS}u+${ENTRY.minWrite}u]=totalNew&~${RENDER_CURVE_SEGMENTS_PER_ENTRY - 1}u;
  }else{
   atomicStore(&tileSegments[layerAt(binner,3u,tile)],totalNew&~${RENDER_CURVE_SEGMENTS_PER_ENTRY - 1}u);
  }
  atomicStore(&tileSegments[info],(previous<<16u)|select(${NO_ENTRY}u,entry&0xFFFFu,fits));
 }
 workgroupBarrier();
 storageBarrier();
 let range=depthRange(atomicLoad(&counters[${COUNTER.minZ}]),atomicLoad(&counters[${COUNTER.maxZ}]),0.0);
 if(valid){
  var dda=ddaCreate(first,last);
  let color=curveViridis(f32(cluster*${RENDER_CURVE_CURVES_PER_CLUSTER}u+curveIndex)/2048.0);
  for(var walk=0u;walk<${RENDER_CURVE_DDA_MAX_STEPS}u;walk++){
   let tile=tileAt(dda.coord);
   if(nearestZ>=tileNearest(tile)){
    let info=atomicLoad(&tileSegments[layerAt(binner,2u,tile)]);
    let current=info&0xFFFFu;
    let previous=info>>16u;
    let old=atomicAdd(&tileSegments[layerAt(binner,1u,tile)],1u);
    let boundary=select(tileData[current*${RENDER_CURVE_ENTRY_WORDS}u+${ENTRY.minWrite}u],atomicLoad(&tileSegments[layerAt(binner,3u,tile)]),current==${NO_ENTRY}u);
    let toCurrent=old>=boundary;
    let slot=select(previous,current,toCurrent);
    if(slot!=${NO_ENTRY}u){
     let at=slot*${RENDER_CURVE_SEGMENTS_PER_ENTRY}u+old%${RENDER_CURVE_SEGMENTS_PER_ENTRY}u;
     if(at<curve.maxSegmentDataCount){
      var q0=sp0;
      var q1=sp1;
      let corner=vec2f(tile*${RENDER_CURVE_BIN_TILE_SIZE}u);
      clipSegment(corner,corner+vec2f(${RENDER_CURVE_BIN_TILE_SIZE}.0),&q0,&q1);
      segmentData[at]=packSegment(tile,range,q0,q1,color);
     }
    }
    if(toCurrent&&current!=${NO_ENTRY}u&&old+1u==atomicLoad(&tileSegments[layerAt(binner,0u,tile)])){
     let filled=(old+1u)%${RENDER_CURVE_SEGMENTS_PER_ENTRY}u;
     tileData[current*${RENDER_CURVE_ENTRY_WORDS}u+${ENTRY.primCount}u]=select(filled,${RENDER_CURVE_SEGMENTS_PER_ENTRY}u,filled==0u);
    }
   }
   if(all(tile==end)){break;}
   gridWalkAdvance(&dda.coord,&dda.side,dda.delta,dda.step);
  }
 }
 workgroupBarrier();
}
@compute @workgroup_size(${RENDER_CURVE_BIN_LANES})
fn binning(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_index) lane:u32){
 let binner=group.x;
 for(var turn=0u;turn<${MAX_CLUSTER_ROUNDS}u;turn++){
  if(lane==0u){
   let fetched=atomicAdd(&counters[${COUNTER.queue}],1u);
   takenActive=select(0u,1u,fetched<atomicLoad(&counters[${COUNTER.visibleClusters}]));
   if(takenActive!=0u){
    let named=visibleClusters[fetched];
    takenCluster=named.y;
    takenToClip=curve.toClip*loadInstance(named.x).localToWorld;
   }
  }
  workgroupBarrier();
  if(workgroupUniformLoad(&takenActive)==0u){break;}
  let cluster=workgroupUniformLoad(&takenCluster);
  let toClip=workgroupUniformLoad(&takenToClip);
  for(var batch=0u;batch<${BATCHES}u;batch++){binBatch(binner,lane,batch,cluster,toClip);}
 }
}`,
  [
    RENDER_CURVE_PARAMS_WGSL,
    RENDER_CURVE_INSTANCE_WGSL,
    RENDER_CURVE_CLUSTER_WGSL,
    RENDER_CURVE_SEGMENT_WGSL,
    RENDER_CURVE_COLOR_WGSL,
    RENDER_CURVE_TILE_PACK_WGSL,
    RENDER_CURVE_PROJECT_WGSL,
    gridWalkAdvance,
    RENDER_CURVE_TILE_LAYER_WGSL,
  ],
)
