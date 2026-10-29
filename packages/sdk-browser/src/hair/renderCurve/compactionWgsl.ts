import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { RENDER_CURVE_ENTRY } from './binningWgsl.ts'
import {
  RENDER_CURVE_COUNTER,
  RENDER_CURVE_PARAMS_WGSL,
  RENDER_CURVE_SEGMENT_WGSL,
  RENDER_CURVE_TILE_PACK_WGSL,
} from './paramsWgsl.ts'
import { RENDER_CURVE_ENTRY_WORDS, RENDER_CURVE_SEGMENTS_PER_ENTRY } from './renderCurveMath.ts'

/** The invocations of a compaction group: also the depth slices a tile's segments are sorted into. */
export const RENDER_CURVE_COMPACT_LANES = 256
/** The entries of one tile a group takes at most, the depth slices of a tile, the z bins a tile's slices are gathered into at most, and the segments a z bin holds at most. */
const MAX_TILE_ENTRIES = 1024
const DEPTH_SLICES = RENDER_CURVE_COMPACT_LANES
const MAX_Z_BINS = 16
const MAX_SEGMENTS_PER_Z_BIN = 1024
const COUNTER = RENDER_CURVE_COUNTER
const ENTRY = RENDER_CURVE_ENTRY

/**
 * THE COMPACTION OF THE BINNED SEGMENTS: a group a bin tile. It gathers the entries of the tile data that name its tile (all binners'),
 * takes room for their segments in the compacted list, sorts them by the depth of their nearest end into 256 slices of the depth range
 * (the range of the visible clusters, held to the scene's furthest depth of the tile), and gathers the slices, nearest first, into z
 * bins of 1024 segments at most (16 at most; the farther slices are dropped). The z bins are written as (first segment, count) and the
 * tile as a piece of raster work: its z bins' first index, their count and its coordinates. A tile that finds no room in the lists is
 * left out whole. Group 0: the shared block (0), the counters (1), the tile data (2), the segments (3), the z bins (4), the compacted
 * segments (5), the raster work (6), the scene's depth per tile (7).
 */
export const RENDER_CURVE_COMPACTION_WGSL = wgslProgram(
  `@group(0) @binding(0) var<uniform> curve:RenderCurveParams;
@group(0) @binding(1) var<storage,read_write> counters:array<atomic<u32>>;
@group(0) @binding(2) var<storage,read> tileData:array<u32>;
@group(0) @binding(3) var<storage,read> segmentData:array<vec4u>;
@group(0) @binding(4) var<storage,read_write> zBinData:array<vec2u>;
@group(0) @binding(5) var<storage,read_write> zBinSegments:array<vec4u>;
@group(0) @binding(6) var<storage,read_write> rasterWork:array<vec2u>;
@group(0) @binding(7) var sceneTileDepth:texture_2d<u32>;
var<workgroup> primCount:atomic<u32>;
var<workgroup> toCompactCount:atomic<u32>;
var<workgroup> toCompact:array<u32,${MAX_TILE_ENTRIES}>;
var<workgroup> proceed:u32;
var<workgroup> primOffset:u32;
var<workgroup> maxZBin:u32;
var<workgroup> sliceCount:array<atomic<u32>,${DEPTH_SLICES}>;
var<workgroup> sliceOffset:array<u32,${DEPTH_SLICES}>;
var<workgroup> binOffset:array<u32,${MAX_Z_BINS}>;
var<workgroup> binCount:array<u32,${MAX_Z_BINS}>;
var<workgroup> binsBase:u32;
var<workgroup> binsFit:u32;
fn sliceOf(depth:f32,range:DepthRange,sceneMinZ:f32)->u32{
 let low=max(range.minZ,sceneMinZ);
 let inv=1.0/max(range.minZ+range.range-low,1e-5);
 let at=u32(clamp(saturate((depth-low)*inv)*${DEPTH_SLICES}.0,0.0,${DEPTH_SLICES - 1}.0));
 return ${DEPTH_SLICES - 1}u-at;
}
@compute @workgroup_size(${RENDER_CURVE_COMPACT_LANES})
fn compaction(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_index) lane:u32){
 if(lane==0u){
  atomicStore(&primCount,0u);
  atomicStore(&toCompactCount,0u);
  maxZBin=${DEPTH_SLICES - 1}u;
 }
 sliceOffset[lane]=0u;
 atomicStore(&sliceCount[lane],0u);
 if(lane<${MAX_Z_BINS}u){
  binOffset[lane]=0u;
  binCount[lane]=0u;
 }
 workgroupBarrier();
 let tile=group.xy;
 let packed=packTile(tile);
 let entries=min(atomicLoad(&counters[${COUNTER.tileData}]),curve.maxTileAllocCount);
 var local=0u;
 for(var e=lane;e<entries;e+=${RENDER_CURVE_COMPACT_LANES}u){
  if(tileData[e*${RENDER_CURVE_ENTRY_WORDS}u+${ENTRY.coord}u]==packed){
   local+=tileData[e*${RENDER_CURVE_ENTRY_WORDS}u+${ENTRY.primCount}u];
   let slot=atomicAdd(&toCompactCount,1u);
   if(slot<${MAX_TILE_ENTRIES}u){toCompact[slot]=e;}
  }
 }
 if(local>0u){atomicAdd(&primCount,local);}
 workgroupBarrier();
 if(lane==0u){
  let total=atomicLoad(&primCount);
  var skip=total==0u;
  if(!skip){
   primOffset=atomicAdd(&counters[${COUNTER.zBinSegments}],total);
   skip=primOffset+total>curve.maxZBinSegmentDataCount;
  }
  proceed=select(1u,0u,skip);
 }
 if(workgroupUniformLoad(&proceed)==0u){return;}
 let inputs=min(atomicLoad(&toCompactCount),${MAX_TILE_ENTRIES}u);
 // The segments are packed over the range of the visible clusters; the slices cut that range at the scene's furthest depth of the tile.
 let packRange=depthRange(atomicLoad(&counters[${COUNTER.minZ}]),atomicLoad(&counters[${COUNTER.maxZ}]),0.0);
 let sceneMinZ=bitcast<f32>(textureLoad(sceneTileDepth,vec2i(tile),0).x);
 for(var i=0u;i<inputs;i++){
  let entry=toCompact[i];
  let count=tileData[entry*${RENDER_CURVE_ENTRY_WORDS}u+${ENTRY.primCount}u];
  for(var s=lane;s<count;s+=${RENDER_CURVE_COMPACT_LANES}u){
   let z=unpackSegmentZ(packRange,segmentData[entry*${RENDER_CURVE_SEGMENTS_PER_ENTRY}u+s]);
   atomicAdd(&sliceCount[sliceOf(max(z.x,z.y),packRange,sceneMinZ)],1u);
  }
 }
 workgroupBarrier();
 if(lane==0u){
  var bins=1u;
  var accumulated=0u;
  var offset=0u;
  binOffset[0]=0u;
  binCount[0]=0u;
  for(var it=0u;it<${DEPTH_SLICES}u;it++){
   sliceOffset[it]=offset;
   let n=atomicLoad(&sliceCount[it]);
   if(accumulated+n<${MAX_SEGMENTS_PER_Z_BIN}u){
    binCount[bins-1u]+=n;
   }else{
    if(bins>=${MAX_Z_BINS}u){
     maxZBin=it-1u;
     break;
    }
    binOffset[bins]=offset;
    binCount[bins]=n;
    bins++;
    accumulated=0u;
   }
   accumulated+=n;
   offset+=n;
  }
  let base=atomicAdd(&counters[${COUNTER.zBins}],bins);
  let fits=base+bins<=curve.maxZBinDataCount;
  binsBase=base;
  binsFit=select(0u,1u,fits);
  if(fits){
   for(var b=0u;b<bins;b++){zBinData[base+b]=vec2u(primOffset+binOffset[b],binCount[b]);}
   let work=atomicAdd(&counters[${COUNTER.rasterWork}],1u);
   if(work<curve.maxRasterWorkCount){rasterWork[work]=vec2u(base,(packed<<16u)|(bins&0xFFFFu));}
  }
 }
 workgroupBarrier();
 if(workgroupUniformLoad(&binsFit)==0u){return;}
 atomicStore(&sliceCount[lane],0u);
 workgroupBarrier();
 let lastSlice=workgroupUniformLoad(&maxZBin);
 for(var i=0u;i<inputs;i++){
  let entry=toCompact[i];
  let count=tileData[entry*${RENDER_CURVE_ENTRY_WORDS}u+${ENTRY.primCount}u];
  for(var s=lane;s<count;s+=${RENDER_CURVE_COMPACT_LANES}u){
   let segment=segmentData[entry*${RENDER_CURVE_SEGMENTS_PER_ENTRY}u+s];
   let z=unpackSegmentZ(packRange,segment);
   let slice=sliceOf(max(z.x,z.y),packRange,sceneMinZ);
   if(slice<=lastSlice){
    let at=primOffset+sliceOffset[slice]+atomicAdd(&sliceCount[slice],1u);
    if(at<curve.maxZBinSegmentDataCount){zBinSegments[at]=segment;}
   }
  }
 }
}`,
  [RENDER_CURVE_PARAMS_WGSL, RENDER_CURVE_SEGMENT_WGSL, RENDER_CURVE_TILE_PACK_WGSL],
)
