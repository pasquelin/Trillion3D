import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { FULLSCREEN_VERTEX } from '../../gpu/shader/fullscreenTriangle.ts'
import {
  RENDER_CURVE_COUNTER,
  RENDER_CURVE_PARAMS_WGSL,
  RENDER_CURVE_SEGMENT_WGSL,
  RENDER_CURVE_TILE_PACK_WGSL,
} from './paramsWgsl.ts'
import { RENDER_CURVE_PROJECT_WGSL } from './projectWgsl.ts'
import { gridWalkAdvance } from '../gridWalkWgsl.ts'
import { RENDER_CURVE_BIN_TILE_SIZE } from './renderCurveMath.ts'

/** The invocations of a rasterizer's group: a quarter of a bin tile's pixels, each invocation drawing four of them (a device's group holds 256 at least). */
export const RENDER_CURVE_RASTER_LANES = 256
/** The format of the image the raster draws: the strands' colour premultiplied by their coverage, and the coverage. */
export const RENDER_CURVE_OUTPUT_FORMAT: GPUTextureFormat = 'rgba16float'
/** The side of a raster tile, the raster tiles of a bin tile (a side, then all), the rounds over a bin tile's pixels, and the segments a step takes. */
const RASTER_TILE = 8
const TILES_PER_SIDE = RENDER_CURVE_BIN_TILE_SIZE / RASTER_TILE
const RASTER_TILES = TILES_PER_SIDE * TILES_PER_SIDE
const PIXELS = RENDER_CURVE_BIN_TILE_SIZE * RENDER_CURVE_BIN_TILE_SIZE
const ROUNDS = PIXELS / RENDER_CURVE_RASTER_LANES
const TILES_PER_ROUND = RENDER_CURVE_RASTER_LANES / (RASTER_TILE * RASTER_TILE)
const SEGMENTS_PER_STEP = 32
/** The (segment, raster tile) pairs a step takes: a thread each. */
const STEP_PAIRS = SEGMENTS_PER_STEP * TILES_PER_ROUND
/** The work a rasterizer takes at most, the segments of a z bin at most, and the share of a pixel one segment that crosses it covers. */
const MAX_TURNS = 4096
const MAX_SEGMENTS_PER_Z_BIN = 1024
const SEGMENT_COVERAGE = 0.2
const NO_WORK = 0xffffffff
const COUNTER = RENDER_CURVE_COUNTER

/**
 * THE CURVE RASTER: a group a rasterizer, which takes the raster work from the queue until it is empty. A piece of work is a bin tile of
 * 32 pixels a side, drawn in four rounds of four raster tiles of 8 (a thread a pixel). The tile's z bins are walked nearest first, each
 * in steps of 32 segments: a thread clips a segment to a raster tile and walks it through the tile's 8 by 8 cells, keeping the cells where
 * it lies in front of the scene (the depth test is made only in a tile the segment is not wholly in front of), as a 64 bit mask; then
 * each pixel takes, in order, the segments whose mask holds its cell, each covering `SEGMENT_COVERAGE` of what the nearer ones left.
 * A round ends once every pixel of the group is covered to `1 - minCoverage` (or is out of the image). The pixels a segment reached are
 * written (colour premultiplied by the coverage, and the coverage) into the output; the others are left as the clear made them.
 * Group 0: the shared block (0), the counters (1), the z bins (2), the compacted segments (3), the raster work (4), the scene's depth (5),
 * the output (6).
 */
export const RENDER_CURVE_RASTER_WGSL = wgslProgram(
  `@group(0) @binding(0) var<uniform> curve:RenderCurveParams;
@group(0) @binding(1) var<storage,read_write> counters:array<atomic<u32>>;
@group(0) @binding(2) var<storage,read> zBinData:array<vec2u>;
@group(0) @binding(3) var<storage,read> zBinSegments:array<vec4u>;
@group(0) @binding(4) var<storage,read> rasterWork:array<vec2u>;
@group(0) @binding(5) var sceneDepth:texture_depth_2d;
@group(0) @binding(6) var colourOut:texture_storage_2d<${RENDER_CURVE_OUTPUT_FORMAT},write>;
var<workgroup> workIndex:u32;
var<workgroup> job:vec4u;
var<workgroup> zInfo:vec2u;
var<workgroup> sceneNearest:array<atomic<u32>,${RASTER_TILES}>;
var<workgroup> segBits:array<vec2u,${STEP_PAIRS}>;
var<workgroup> segColour:array<vec4f,${STEP_PAIRS}>;
var<workgroup> alive:atomic<u32>;
var<workgroup> aliveCount:u32;
fn pixelOf(p:u32)->vec2u{
 let tile=p/${RASTER_TILE * RASTER_TILE}u;
 let cell=p%${RASTER_TILE * RASTER_TILE}u;
 return vec2u((tile%${TILES_PER_SIDE}u)*${RASTER_TILE}u+cell%${RASTER_TILE}u,(tile/${TILES_PER_SIDE}u)*${RASTER_TILE}u+cell/${RASTER_TILE}u);
}
fn segmentBits(origin:vec2u,begin:vec2f,finish:vec2f,z0:f32,z1:f32,test:bool)->vec2u{
 var bits=vec2u(0u);
 var dda=ddaCreate(begin,finish);
 let start=vec2i(floor(begin));
 let end=vec2i(floor(finish));
 let span=length(vec2f(end-start));
 for(var walk=0u;walk<${2 * RASTER_TILE}u;walk++){
  let cell=clamp(vec2i(floor(dda.coord)),vec2i(0),vec2i(${RASTER_TILE - 1}));
  var visible=true;
  if(test){
   let along=select(0.0,clamp(length(vec2f(cell-start))/span,0.0,1.0),span>0.0);
   let at=min(origin+vec2u(cell),curve.resolution-vec2u(1u));
   visible=mix(z0,z1,along)>textureLoad(sceneDepth,vec2i(at),0);
  }
  if(visible){
   let bit=u32(cell.x+cell.y*${RASTER_TILE});
   if(bit<32u){bits.x|=1u<<bit;}else{bits.y|=1u<<(bit-32u);}
  }
  if(all(cell==end)){break;}
  gridWalkAdvance(&dda.coord,&dda.side,dda.delta,dda.step);
 }
 return bits;
}
@compute @workgroup_size(${RENDER_CURVE_RASTER_LANES})
fn rasterize(@builtin(local_invocation_index) lane:u32){
 let range=depthRange(atomicLoad(&counters[${COUNTER.minZ}]),atomicLoad(&counters[${COUNTER.maxZ}]),0.0);
 for(var turn=0u;turn<${MAX_TURNS}u;turn++){
  if(lane==0u){
   let fetched=atomicAdd(&counters[${COUNTER.rasterQueue}],1u);
   let total=min(atomicLoad(&counters[${COUNTER.rasterWork}]),curve.maxRasterWorkCount);
   workIndex=select(${NO_WORK}u,fetched,fetched<total);
   if(fetched<total){
    let entry=rasterWork[fetched];
    let tile=unpackTile(entry.y>>16u);
    job=vec4u(entry.x,entry.y&0xFFFFu,tile.x,tile.y);
   }
   for(var t=0u;t<${RASTER_TILES}u;t++){atomicStore(&sceneNearest[t],0u);}
  }
  if(workgroupUniformLoad(&workIndex)==${NO_WORK}u){return;}
  let piece=workgroupUniformLoad(&job);
  let origin=piece.zw*${RENDER_CURVE_BIN_TILE_SIZE}u;
  for(var round=0u;round<${ROUNDS}u;round++){
   let p=round*${RENDER_CURVE_RASTER_LANES}u+lane;
   let pixel=origin+pixelOf(p);
   if(all(pixel<curve.resolution)){atomicMax(&sceneNearest[p/${RASTER_TILE * RASTER_TILE}u],bitcast<u32>(textureLoad(sceneDepth,vec2i(pixel),0)));}
  }
  workgroupBarrier();
  for(var round=0u;round<${ROUNDS}u;round++){
   let p=round*${RENDER_CURVE_RASTER_LANES}u+lane;
   let pixel=origin+pixelOf(p);
   let inside=all(pixel<curve.resolution);
   let cellBit=p%${RASTER_TILE * RASTER_TILE}u;
   let stepTile=lane/${RASTER_TILE * RASTER_TILE}u;
   var transmittance=1.0;
   var colour=vec3f(0.0);
   var finished=false;
   for(var zi=0u;zi<piece.y;zi++){
    if(finished){break;}
    if(lane==0u){
     let bin=zBinData[piece.x+zi];
     zInfo=vec2u(bin.x,min(bin.y,${MAX_SEGMENTS_PER_Z_BIN}u));
    }
    let zbin=workgroupUniformLoad(&zInfo);
    for(var first=0u;first<zbin.y;first+=${SEGMENTS_PER_STEP}u){
     if(lane==0u){atomicStore(&alive,0u);}
     if(lane<${STEP_PAIRS}u){
      let at=first+lane%${SEGMENTS_PER_STEP}u;
      let tile=round*${TILES_PER_ROUND}u+lane/${SEGMENTS_PER_STEP}u;
      var bits=vec2u(0u);
      var tint=vec3f(0.0);
      if(at<zbin.y){
       let segment=unpackSegment(vec2u(0u),range,zBinSegments[zbin.x+at]);
       tint=segment.color;
       let low=vec2f(f32((tile%${TILES_PER_SIDE}u)*${RASTER_TILE}u),f32((tile/${TILES_PER_SIDE}u)*${RASTER_TILE}u));
       var p0=segment.p0;
       var p1=segment.p1;
       if(clipSegment(low,low+vec2f(${RASTER_TILE}.0),&p0,&p1)){
        let top=vec2f(${RASTER_TILE}.0*0.999);
        let test=min(p0.z,p1.z)<bitcast<f32>(atomicLoad(&sceneNearest[tile]));
        bits=segmentBits(origin+vec2u(low),clamp(p0.xy-low,vec2f(0.0),top),clamp(p1.xy-low,vec2f(0.0),top),p0.z,p1.z,test);
       }
      }
      segBits[lane]=bits;
      segColour[lane]=vec4f(tint,0.0);
     }
     workgroupBarrier();
     for(var s=0u;s<${SEGMENTS_PER_STEP}u;s++){
      if(first+s>=zbin.y){break;}
      let bits=segBits[stepTile*${SEGMENTS_PER_STEP}u+s];
      if(((select(bits.x,bits.y,cellBit>=32u)>>(cellBit&31u))&1u)!=0u){
       colour+=transmittance*${SEGMENT_COVERAGE}*segColour[stepTile*${SEGMENTS_PER_STEP}u+s].xyz;
       transmittance*=${1 - SEGMENT_COVERAGE};
      }
     }
     if(inside&&transmittance>=curve.minCoverage){atomicAdd(&alive,1u);}
     workgroupBarrier();
     if(lane==0u){aliveCount=atomicLoad(&alive);}
     if(workgroupUniformLoad(&aliveCount)==0u){
      finished=true;
      break;
     }
    }
   }
   if(inside&&transmittance<1.0){textureStore(colourOut,vec2i(pixel),vec4f(colour,1.0-transmittance));}
   workgroupBarrier();
  }
  workgroupBarrier();
 }
}`,
  [
    RENDER_CURVE_PARAMS_WGSL,
    RENDER_CURVE_SEGMENT_WGSL,
    RENDER_CURVE_TILE_PACK_WGSL,
    RENDER_CURVE_PROJECT_WGSL,
    gridWalkAdvance,
  ],
)

/**
 * THE CURVE RASTER'S IMAGE LAID ON THE LIT IMAGE: the strands' colour premultiplied by their coverage is added over what the coverage leaves of
 * the image (a blend of one and one minus the source's alpha). Group 0: the raster's output (0).
 */
export const RENDER_CURVE_COMPOSE_WGSL = wgslProgram(
  `@group(0) @binding(0) var curveColour:texture_2d<f32>;
@fragment fn composeCurves(@builtin(position) position:vec4f)->@location(0) vec4f{
 return textureLoad(curveColour,vec2i(position.xy),0);
}`,
  [FULLSCREEN_VERTEX],
)
