import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { closureCountOf, closuresHeldOf } from '../../materials/surface/surfaceOutputs.ts'
import { MAX_CLOSURES } from '../../../../sdk-core/src/world/material/graph/closures.ts'

/** The side of a closure tile, in pixels: the reference's (`SUBSTRATE_TILE_SIZE`). */
export const CLOSURE_TILE_SIZE = 8
export const CLOSURE_TILES_ENTRY = 'closureTilesMain'
export const CLOSURE_ARGS_ENTRY = 'closureArgsMain'

/** The bindings of the closure tile kernels, in group 0. */
export const CLOSURE_TILE_BINDINGS = { words: 0, list: 1, args: 2 } as const

const B = CLOSURE_TILE_BINDINGS

/** Words at the head of a closure's region of the list: the entries counted, then the tiles along a row of the frame (the width of the dispatch the entries are read by). */
export const CLOSURE_REGION_HEAD = 2

/** Words a region of the list is rounded up to: 256 bytes, the offset a storage binding may start at on any device. */
const REGION_ALIGN = 64

/** The words one closure's region holds for a frame of `tiles` tiles along each side: its head, then an entry a tile at most, rounded to `REGION_ALIGN`. */
export const closureRegionWords = (tiles: readonly [number, number]) =>
  ceilDiv(CLOSURE_REGION_HEAD + tiles[0] * tiles[1], REGION_ALIGN) * REGION_ALIGN

/** The bytes at which the region of the closure `closure` (from the second, 1) starts in the list, and the bytes it spans: a storage binding of the region reads it as a list of its own. */
export const closureRegionOf = (tiles: readonly [number, number], closure: number) => {
  const bytes = 4 * closureRegionWords(tiles)
  return { offset: bytes * (closure - 1), size: bytes }
}

/** The bytes at which the indirect dispatch over the closure `closure`'s tiles starts in the arguments. */
export const closureArgsAt = (closure: number) => 12 * (closure - 1)

/** The bytes the arguments hold: the dispatch of each closure past the first. */
export const CLOSURE_ARGS_BYTES = 12 * (MAX_CLOSURES - 1)

/** The tiles along a side an entry's coordinate holds: twelve bits each, so frames to 32768 pixels a side, past any texture a device allows. */
export const CLOSURE_TILE_COORD_MAX = 4096

/** An entry of the list, as the kernel packs it (`packClosureTile`): twelve bits a coordinate, four the closure's index, four the tile's count of closures. */
export const packClosureTile = (x: number, y: number, index: number, count: number) =>
  ((x & 4095) | ((y & 4095) << 12) | ((index & 15) << 24) | ((count & 15) << 28)) >>> 0

/** The tile, the closure's index and the count of closures an entry names. */
export const unpackClosureTile = (word: number) => ({
  x: word & 4095,
  y: (word >>> 12) & 4095,
  index: (word >>> 24) & 15,
  count: (word >>> 28) & 15,
})

/**
 * THE CLOSURE'S REGION OF THE LIST, read by a kernel over its overflow tiles: the region (a binding over `closureRegionOf`) is the read-only storage array `overflowList` at the binding `binding` of group 0, and
 * `overflowTileAt` gives the tile of the entry a workgroup of the indirect dispatch (`closureArgsMain`) stands for, in `.xy`, and in `.z` whether the entry is listed (the workgroups past the count, a last row's,
 * are not): the entry is `group.y` rows of the head's tiles along plus `group.x`.
 */
export const overflowTilesBlock = (binding: number) =>
  wgslBlock(
    `OVERFLOW_TILES(${binding})`,
    [],
    `@group(0) @binding(${binding}) var<storage,read> overflowList:array<u32>;
fn overflowTileAt(group:vec3u)->vec3u{
 let index=group.y*overflowList[1]+group.x;
 if(index>=overflowList[0]){return vec3u(0u);}
 let entry=overflowList[${CLOSURE_REGION_HEAD}u+index];
 return vec3u(entry&4095u,(entry>>12u)&4095u,1u);
}`,
  )

/**
 * THE CLOSURE TILES, as the reference classifies them (`ClosureTileMainCS`): a group a
 * tile of eight by eight pixels reads each pixel's closure offsets word, the last layer of the words target, and counts the closures
 * from it (the first, and one for each entry that is not zero) and takes the tile's most; a tile whose most is above one appends one entry for each
 * closure past the first (the first is in the record's first layers), the tile's coordinate, the closure's index and the tile's count
 * packed in thirty-two bits (twelve bits a coordinate, four the index, four the count). The reference keeps one list for every
 * closure and reads each entry's index; here each closure past the first has a region of the list of its own (`closureRegionOf`: the entries counted, the
 * tiles along a row, the entries), because the kernels that read it are bound to that closure's textures and take it as a list of their own; the entries of
 * a region are counted by an atomic. `closureArgsMain` then writes the indirect dispatch of each region as the reference does (`ArgsMainCS`, :459-506): a
 * row of at most the frame's tiles along x, as many rows as the count asks. The frame size comes from the words target.
 */
export const closureTilesWgsl = () =>
  wgslProgram(
    `@group(0) @binding(${B.words}) var words:texture_2d_array<u32>;
@group(0) @binding(${B.list}) var<storage,read_write> tileList:array<atomic<u32>>;
@group(0) @binding(${B.args}) var<storage,read_write> tileArgs:array<u32,${3 * (MAX_CLOSURES - 1)}>;
var<workgroup> tileClosures:atomic<u32>;
fn packClosureTile(tile:vec2u,index:u32,count:u32)->u32{return (tile.x&4095u)|((tile.y&4095u)<<12u)|((index&15u)<<24u)|((count&15u)<<28u);}
fn tilesAlong()->vec2u{return (textureDimensions(words).xy+${CLOSURE_TILE_SIZE - 1}u)/${CLOSURE_TILE_SIZE}u;}
/** The words a closure's region of the list spans. */
fn regionStride()->u32{
 let tiles=tilesAlong();
 return (${CLOSURE_REGION_HEAD}u+tiles.x*tiles.y+${REGION_ALIGN - 1}u)/${REGION_ALIGN}u*${REGION_ALIGN}u;
}
/** The closures of a pixel, by its offsets word: the first, and one for each step that is not zero, none past what the record holds. */
fn closuresOfPixel(pixel:vec2u)->u32{
 let layers=textureNumLayers(words);
 return closureCountOf(textureLoad(words,vec2i(pixel),i32(layers)-1,0).x,closuresHeldOf(layers));
}
@compute @workgroup_size(${CLOSURE_TILE_SIZE},${CLOSURE_TILE_SIZE},1)
fn ${CLOSURE_TILES_ENTRY}(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_id) lane:vec3u,@builtin(local_invocation_index) index:u32){
 if(index==0u){atomicStore(&tileClosures,0u);}
 workgroupBarrier();
 let pixel=group.xy*${CLOSURE_TILE_SIZE}u+lane.xy;
 if(all(pixel<textureDimensions(words).xy)){atomicMax(&tileClosures,closuresOfPixel(pixel));}
 workgroupBarrier();
 if(index==0u){
  let n=atomicLoad(&tileClosures);
  let stride=regionStride();
  for(var k=1u;k<n;k++){
   let region=(k-1u)*stride;
   let at=atomicAdd(&tileList[region],1u);
   atomicStore(&tileList[region+${CLOSURE_REGION_HEAD}u+at],packClosureTile(group.xy,k,n));
  }
 }
}
@compute @workgroup_size(1)
fn ${CLOSURE_ARGS_ENTRY}(){
 let along=tilesAlong().x;
 let stride=regionStride();
 let regions=min(arrayLength(&tileList)/stride,${MAX_CLOSURES - 1}u);
 for(var k=0u;k<regions;k++){
  let count=atomicLoad(&tileList[k*stride]);
  atomicStore(&tileList[k*stride+1u],along);
  tileArgs[3u*k]=min(count,along);
  tileArgs[3u*k+1u]=(count+along-1u)/along;
  tileArgs[3u*k+2u]=1u;
 }
}`,
    [closuresHeldOf, closureCountOf],
  )
