import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { HAIR_STRANDS_CONTROL_POINT_END } from '../../../../sdk-core/src/contracts/hairStrandsAbi.ts'
import { HAIR_NODE_COUNTER_STORED, HAIR_NODE_COUNTERS } from '../visibilityMath.ts'
import { FORWARD_THREADS, FORWARD_TILE, FORWARD_TILE_PRIMS } from './forwardMath.ts'
import {
  FORWARD_BINDINGS_WGSL,
  FORWARD_CONSTANTS_WGSL,
  FORWARD_PARAMS_WGSL,
  forwardClipSegment,
  forwardPacking,
  groupSync,
  forwardPoint,
  forwardToPixel,
  forwardWalk,
} from './forwardCommonWgsl.ts'

/** The bindings of the passes over the grid (group 0, after the parameters and the view). */
const FORWARD_BIN_BINDING = {
  points: 2,
  nodeCounter: 3,
  grid: 4,
  prims: 5,
  primDepths: 6,
  tiles: 7,
  counters: 8,
} as const
const B = FORWARD_BIN_BINDING
const T = FORWARD_TILE
const BATCH = FORWARD_TILE_PRIMS
const PER_THREAD = BATCH / FORWARD_THREADS

/** The binding of the depth grid pass: the opaque depth and the grid (the parameters are binding 0). */
const FORWARD_DEPTH_GRID_BINDING = { sceneDepth: 1, grid: 2 } as const

/** The word of tile `tile` of layer `layer` of binner `binner` in the binners' grid, and of the furthest opaque depth of a tile. */
const GRID_WGSL = `fn tileCount()->u32{return params.binRes.x*params.binRes.y;}
fn gridAt(layer:u32,binner:u32,tile:vec2u)->u32{return (layer*params.numBinners+binner)*tileCount()+tile.y*params.binRes.x+tile.x;}
fn depthAt(tile:vec2u)->u32{return LAYER_COUNT*params.numBinners*tileCount()+tile.y*params.binRes.x+tile.x;}`

/**
 * THE FURTHEST OPAQUE DEPTH OF EACH TILE of 32 pixels (the reverse depth's least): a group a tile, each thread some of its pixels, the least taken
 * in workgroup memory and stored in the grid after the binners' layers.
 */
export const FORWARD_DEPTH_GRID_WGSL = wgslProgram(
  `@group(0) @binding(0) var<uniform> params:ForwardParams;
@group(0) @binding(${FORWARD_DEPTH_GRID_BINDING.sceneDepth}) var sceneDepth:texture_depth_2d;
@group(0) @binding(${FORWARD_DEPTH_GRID_BINDING.grid}) var<storage,read_write> grid:array<atomic<u32>>;
${GRID_WGSL}
var<workgroup> furthest:atomic<u32>;
@compute @workgroup_size(${FORWARD_THREADS}) fn forwardDepthGrid(@builtin(workgroup_id) block:vec3u,@builtin(local_invocation_index) lane:u32){
 if(lane==0u){atomicStore(&furthest,0xffffffffu);}
 workgroupBarrier();
 for(var k=lane;k<BIN_TILE*BIN_TILE;k+=THREADS){
  let pixel=vec2u(k%BIN_TILE,k/BIN_TILE)+block.xy*BIN_TILE;
  if(all(pixel<params.size)){atomicMin(&furthest,depthBits(textureLoad(sceneDepth,vec2i(pixel),0)));}
 }
 workgroupBarrier();
 if(lane==0u){atomicStore(&grid[depthAt(block.xy)],atomicLoad(&furthest));}
}`,
  [FORWARD_PARAMS_WGSL, FORWARD_CONSTANTS_WGSL, forwardPacking],
)

/** Where a segment lies, in tiles, with its depth range: none where it is the last of a strand, cut away, or has no point after it. */
const SEGMENT_WGSL = `struct BinSegment{ok:bool,a:vec2f,b:vec2f,maxZ:u32,minZ:u32}
fn binSegment(prim:u32,count:u32)->BinSegment{
 var s=BinSegment(false,vec2f(0.0),vec2f(0.0),0u,0u);
 if(prim+1u>=count){return s;}
 let first=forwardPoint(prim);
 if(first.kind==${HAIR_STRANDS_CONTROL_POINT_END}u){return s;}
 let cut=forwardClipSegment(first.clip,forwardPoint(prim+1u).clip);
 if(!cut.ok){return s;}
 let p0=forwardToPixel(cut.a);
 let p1=forwardToPixel(cut.b);
 let top=vec2f(params.binRes)-vec2f(0.01);
 s.ok=true;
 s.a=clamp(p0.xy/f32(BIN_TILE),vec2f(0.0),top);
 s.b=clamp(p1.xy/f32(BIN_TILE),vec2f(0.0),top);
 s.maxZ=depthBits(saturate(max(p0.z,p1.z)));
 s.minZ=depthBits(saturate(min(p0.z,p1.z)));
 return s;
}`

/** One step of the walk over the tiles, written for each of the three phases: the tile, whether it lies in the grid and the segment is in front of what the tile holds of the opaque. */
const REACHED_WGSL = `fn reached(w:Walk,s:BinSegment)->bool{
 let tile=walkTile(w);
 if(tile.x<0||tile.y<0||u32(tile.x)>=params.binRes.x||u32(tile.y)>=params.binRes.y){return false;}
 return s.maxZ>atomicLoad(&grid[depthAt(vec2u(tile))]);
}`

/**
 * THE BINNING: the segments between neighbouring control points (all but the last of a strand) are cut to the view, projected, and
 * walked over the tiles of 32 pixels they cross, every tile in front of the opaque depth it holds. The workgroups are the binners, each taking
 * a run of batches of 1024 segments, and each batch goes through three steps with a barrier between: every tile a segment reaches counts it
 * (and keeps the range of depths) and the tiles that reach the start of a list of 1024 are noted; the noted tiles are given a list of tiles
 * (one counter, a list a binner of a tile gets its own) and the list that was being filled is told it is full; each segment is written to
 * the list of its tile (the new one from the first segment it holds, the one before otherwise). A list holds its count, the tile's
 * coordinates, the first segment of the tile it holds and the depth range of the tile, `FORWARD_TILE` words.
 */
export const FORWARD_BIN_WGSL = wgslProgram(
  `${FORWARD_BINDINGS_WGSL}
@group(0) @binding(${B.points}) var<storage,read> points:array<vec4f>;
@group(0) @binding(${B.nodeCounter}) var<storage,read> nodeCounter:array<u32,${HAIR_NODE_COUNTERS}>;
@group(0) @binding(${B.grid}) var<storage,read_write> grid:array<atomic<u32>>;
@group(0) @binding(${B.prims}) var<storage,read_write> prims:array<u32>;
@group(0) @binding(${B.primDepths}) var<storage,read_write> primDepths:array<u32>;
@group(0) @binding(${B.tiles}) var<storage,read_write> tiles:array<u32>;
@group(0) @binding(${B.counters}) var<storage,read_write> counters:array<atomic<u32>>;
${GRID_WGSL}
${SEGMENT_WGSL}
${REACHED_WGSL}
struct BinRun{count:u32,batches:u32,loops:u32}
var<workgroup> run:BinRun;
var<workgroup> allocCount:atomic<u32>;
var<workgroup> allocTiles:array<u32,${BATCH}>;
@compute @workgroup_size(${FORWARD_THREADS}) fn forwardBin(@builtin(workgroup_id) block:vec3u,@builtin(local_invocation_index) lane:u32){
 let binner=block.x;
 if(lane==0u){
  let count=nodeCounter[${HAIR_NODE_COUNTER_STORED}];
  let batches=(count+${BATCH - 1}u)/${BATCH}u;
  run=BinRun(count,batches,(batches+params.numBinners-1u)/params.numBinners);
 }
 let r=workgroupUniformLoad(&run);
 for(var turn=0u;turn<r.loops;turn++){
  let batch=turn+binner*r.loops;
  let live=batch<r.batches;
  if(lane==0u){atomicStore(&allocCount,0u);}
  groupSync();
  // The tiles each segment reaches count it; a tile whose count reaches the start of a list is noted.
  for(var k=0u;k<${PER_THREAD}u;k++){
   let prim=batch*${BATCH}u+lane+k*THREADS;
   let s=binSegment(prim,select(0u,r.count,live));
   if(!s.ok){continue;}
   var w=walkStart(s.a,s.b);
   for(var it=0;it<WALK_STEPS;it++){
    if(reached(w,s)){
     let tile=vec2u(walkTile(w));
     let old=atomicAdd(&grid[gridAt(LAYER_COUNTED,binner,tile)],1u);
     atomicMax(&grid[gridAt(LAYER_MIN,binner,tile)],~s.minZ);
     atomicMax(&grid[gridAt(LAYER_MAX,binner,tile)],s.maxZ);
     if(old%${BATCH}u==0u){
      let at=atomicAdd(&allocCount,1u);
      if(at<${BATCH}u){allocTiles[at]=packCoord(tile);}
     }
    }
    if(walkDone(w)){break;}
    gridWalkAdvance(&w.coord,&w.side,w.delta,w.step);
   }
  }
  groupSync();
  // The noted tiles are given a list; the one that was being filled is full.
  let noted=min(${BATCH}u,atomicLoad(&allocCount));
  for(var t=lane;t<noted;t+=THREADS){
   let packed=allocTiles[t];
   let tile=unpackCoord(packed);
   let total=atomicLoad(&grid[gridAt(LAYER_COUNTED,binner,tile)]);
   let written=atomicLoad(&grid[gridAt(LAYER_WRITTEN,binner,tile)]);
   let depths=pack2x16float(vec2f(depthOf(~atomicLoad(&grid[gridAt(LAYER_MIN,binner,tile)])),depthOf(atomicLoad(&grid[gridAt(LAYER_MAX,binner,tile)]))));
   let fresh=atomicAdd(&counters[COUNTER_BINNED],1u);
   if(fresh<params.maxTiles){
    let o=fresh*${T.words}u;
    tiles[o+${T.coord}u]=packed;
    tiles[o+${T.firstWrite}u]=(total-1u)&~${BATCH - 1}u;
    tiles[o+${T.depth}u]=depths;
   }
   let current=atomicLoad(&grid[gridAt(LAYER_CURRENT,binner,tile)]);
   if(written>0u&&current<params.maxTiles){tiles[current*${T.words}u+${T.count}u]=${BATCH}u;}
   atomicStore(&grid[gridAt(LAYER_PREVIOUS,binner,tile)],current);
   atomicStore(&grid[gridAt(LAYER_CURRENT,binner,tile)],fresh);
  }
  groupSync();
  // Each segment is written to the list of every tile it reaches.
  for(var k=0u;k<${PER_THREAD}u;k++){
   let prim=batch*${BATCH}u+lane+k*THREADS;
   let s=binSegment(prim,select(0u,r.count,live));
   if(!s.ok){continue;}
   var w=walkStart(s.a,s.b);
   for(var it=0;it<WALK_STEPS;it++){
    if(reached(w,s)){
     let tile=vec2u(walkTile(w));
     let current=atomicLoad(&grid[gridAt(LAYER_CURRENT,binner,tile)]);
     let previous=atomicLoad(&grid[gridAt(LAYER_PREVIOUS,binner,tile)]);
     let old=atomicAdd(&grid[gridAt(LAYER_WRITTEN,binner,tile)],1u);
     let firstHere=select(0u,tiles[current*${T.words}u+${T.firstWrite}u],current<params.maxTiles);
     let toCurrent=old>=firstHere;
     let list=select(previous,current,toCurrent);
     let local=old%${BATCH}u;
     if(list<params.maxTiles){
      prims[list*${BATCH}u+local]=prim;
      primDepths[list*${BATCH}u+local]=s.maxZ;
     }
     if(toCurrent&&current<params.maxTiles&&old+1u==atomicLoad(&grid[gridAt(LAYER_COUNTED,binner,tile)])){
      tiles[current*${T.words}u+${T.count}u]=local+1u;
     }
    }
    if(walkDone(w)){break;}
    gridWalkAdvance(&w.coord,&w.side,w.delta,w.step);
   }
  }
  groupSync();
 }
}`,
  [
    FORWARD_PARAMS_WGSL,
    FORWARD_CONSTANTS_WGSL,
    forwardPacking,
    groupSync,
    forwardPoint,
    forwardClipSegment,
    forwardToPixel,
    forwardWalk,
  ],
)
