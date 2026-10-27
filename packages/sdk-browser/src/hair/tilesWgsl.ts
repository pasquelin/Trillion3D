import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { wgslBlock, wgslFn } from '../../../math/src/wgsl/decl.ts'
import { SUBGROUP_ALL_WGSL } from '../gpu/core/subgroups.ts'
import { GROUP_GRID_WGSL } from '../gpu/dispatch/grid.ts'
import { HAIR_IMAGE_WGSL } from './imageBlock.ts'
import {
  HAIR_COORD_BITS,
  HAIR_COORD_MASK,
  HAIR_DISPATCH_ARGS_WORDS,
  HAIR_DRAW_ARGS_WORDS,
  HAIR_TILE_ALL,
  HAIR_TILE_FULL,
  HAIR_TILE_LISTS,
  HAIR_TILE_PARTIAL,
  HAIR_TILE_SIZE,
  HAIR_TILE_VERTICES,
  HAIR_TRANSMITTANCE_FORMAT,
} from './visibilityMath.ts'

/** The threads of a tile's workgroup: a thread a pixel. */
const TILE_THREADS = HAIR_TILE_SIZE * HAIR_TILE_SIZE

/** The pixel `local` of the tile whose word is `tile` (its x on the low `HAIR_COORD_BITS` bits, its y
 *  above, as `emit` packs it): the one reading of a tile's word, for every pass over the lists. */
export const hairTilePixel = wgslFn(
  'hairTilePixel',
  [],
  `fn hairTilePixel(tile:u32,local:vec2u)->vec2u{return vec2u(tile&${HAIR_COORD_MASK}u,tile>>${HAIR_COORD_BITS}u)*${HAIR_TILE_SIZE}u+local;}`,
)

/** The pixel `local` of the tile of rank `rank` in the list of all the tiles with strands, and whether
 *  the tile is listed and the pixel lies in the image: the pixel of a thread of a pass over that list,
 *  a group a tile. Its host declares the lists' `counts` and `tiles`. */
export const hairListedPixel = wgslBlock(
  'hairListedPixel',
  [HAIR_IMAGE_WGSL, hairTilePixel],
  `struct HairListedPixel{pixel:vec2u,ok:bool}
fn hairListedPixel(rank:u32,local:vec2u)->HairListedPixel{
 if(rank>=counts[${HAIR_TILE_ALL}]){return HairListedPixel(vec2u(0u),false);}
 let pixel=hairTilePixel(tiles[${HAIR_TILE_ALL}u*image.capacity+rank],local);
 return HairListedPixel(pixel,all(pixel<image.size));
}`,
)

const CLASSIFY_WGSL = wgslBlock(
  'HAIR_TILE_CLASSIFY_WGSL',
  [HAIR_IMAGE_WGSL],
  `@group(0) @binding(1) var transmittance:texture_storage_2d<${HAIR_TRANSMITTANCE_FORMAT},read>;
@group(0) @binding(2) var<storage,read_write> counts:array<atomic<u32>,${HAIR_TILE_LISTS}>;
@group(0) @binding(3) var<storage,read_write> tiles:array<u32>;
fn emit(list:u32,tile:vec2u){
 let at=atomicAdd(&counts[list],1u);
 tiles[list*image.capacity+at]=tile.x|(tile.y<<${HAIR_COORD_BITS}u);
}
fn classify(full:bool,partial:bool,tile:vec2u){
 if(full||partial){emit(${HAIR_TILE_ALL}u,tile);}
 if(full){emit(${HAIR_TILE_FULL}u,tile);}else if(partial){emit(${HAIR_TILE_PARTIAL}u,tile);}
}
fn pixelClass(pixel:vec2u)->vec2<bool>{
 if(!all(pixel<image.size)){return vec2<bool>(false,false);}
 let t=textureLoad(transmittance,vec2i(pixel)).r;
 return vec2<bool>(t<=1.0-image.fullCoverage,t<1.0);
}`,
)

/**
 * THE TILES: the rectangle the strands cover cut in tiles of `HAIR_TILE_SIZE` pixels, each put in
 * the lists by the transmittance over its pixels: with any strand (all), and either with a strand
 * over every pixel (full: the transmittance at most what a full coverage leaves) or with some strand
 * over some pixel (partial: the transmittance below 1). A tile with none is in no list; the strands
 * lie in the rectangle, so none outside it is classified. The lists are built by the tiles'
 * workgroups, each adding its tile at the end of its lists (the order of a list is the groups').
 *
 * The workgroup of a tile is its pixels: whether all of them are full, whether any is partial, is
 * known by a subgroup vote where every subgroup of the device is 64 or 32 lanes wide (a tile is one
 * subgroup or two, which share their votes in workgroup memory), else by folding a 64-bit mask of the
 * pixels in the workgroup's memory.
 */
export const WORKGROUP_TILES_WGSL = wgslProgram(
  `var<workgroup> fullMask:array<vec2u,${TILE_THREADS}>;
var<workgroup> partialMask:array<vec2u,${TILE_THREADS}>;
@compute @workgroup_size(${HAIR_TILE_SIZE},${HAIR_TILE_SIZE},1) fn hairTiles(@builtin(workgroup_id) block:vec3u,@builtin(local_invocation_id) local:vec3u,@builtin(local_invocation_index) lane:u32){
 let tile=block.xy+image.origin;
 let kind=pixelClass(tile*${HAIR_TILE_SIZE}u+local.xy);
 let bit=select(vec2u(1u<<lane,0u),vec2u(0u,1u<<(lane-32u)),lane>=32u);
 fullMask[lane]=select(vec2u(0u),bit,kind.x);
 partialMask[lane]=select(vec2u(0u),bit,kind.y);
 workgroupBarrier();
 var stride=${TILE_THREADS / 2}u;
 loop{
  if(lane<stride){
   fullMask[lane]=fullMask[lane]|fullMask[lane+stride];
   partialMask[lane]=partialMask[lane]|partialMask[lane+stride];
  }
  workgroupBarrier();
  if(stride==1u){break;}
  stride=stride>>1u;
 }
 if(lane==0u){classify(all(fullMask[0]==vec2u(0xffffffffu)),any(partialMask[0]!=vec2u(0u)),tile);}
}`,
  [CLASSIFY_WGSL],
)

export const SUBGROUP_TILES_WGSL = wgslProgram(
  `var<workgroup> allFull:atomic<u32>;
var<workgroup> anyPartial:atomic<u32>;
@compute @workgroup_size(${HAIR_TILE_SIZE},${HAIR_TILE_SIZE},1) fn hairTiles(@builtin(workgroup_id) block:vec3u,@builtin(local_invocation_id) local:vec3u,@builtin(local_invocation_index) lane:u32){
 let tile=block.xy+image.origin;
 let kind=pixelClass(tile*${HAIR_TILE_SIZE}u+local.xy);
 if(lane==0u){
  atomicStore(&allFull,1u);
  atomicStore(&anyPartial,0u);
 }
 workgroupBarrier();
 let full=subgroupAll(kind.x);
 let partial=subgroupAny(kind.y);
 if(subgroupElect()){
  atomicAnd(&allFull,u32(full));
  atomicOr(&anyPartial,u32(partial));
 }
 workgroupBarrier();
 if(lane==0u){classify(atomicLoad(&allFull)!=0u,atomicLoad(&anyPartial)!=0u,tile);}
}`,
  [SUBGROUP_ALL_WGSL, CLASSIFY_WGSL],
)

/**
 * The arguments of the draws and dispatches over each list of tiles, one thread a list: a draw of
 * the tile's two triangles for each tile, a dispatch of one group a tile in rows (the rank of a group
 * in its list is its flat rank, `flatIndex`).
 */
export const ARGS_WGSL = wgslProgram(
  `@group(0) @binding(0) var<storage,read> counts:array<u32,${HAIR_TILE_LISTS}>;
@group(0) @binding(1) var<storage,read_write> drawArgs:array<u32>;
@group(0) @binding(2) var<storage,read_write> dispatchArgs:array<u32>;
@compute @workgroup_size(${HAIR_TILE_LISTS}) fn hairTileArgs(@builtin(local_invocation_index) list:u32){
 let n=counts[list];
 let groups=groupGrid(n);
 drawArgs[list*${HAIR_DRAW_ARGS_WORDS}u]=${HAIR_TILE_VERTICES}u;
 drawArgs[list*${HAIR_DRAW_ARGS_WORDS}u+1u]=n;
 drawArgs[list*${HAIR_DRAW_ARGS_WORDS}u+2u]=0u;
 drawArgs[list*${HAIR_DRAW_ARGS_WORDS}u+3u]=0u;
 dispatchArgs[list*${HAIR_DISPATCH_ARGS_WORDS}u]=groups.x;
 dispatchArgs[list*${HAIR_DISPATCH_ARGS_WORDS}u+1u]=groups.y;
 dispatchArgs[list*${HAIR_DISPATCH_ARGS_WORDS}u+2u]=1u;
}`,
  [GROUP_GRID_WGSL],
)
