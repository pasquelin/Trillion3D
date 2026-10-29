import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslFn } from '../../../../../math/src/wgsl/decl.ts'
import { VG_TYPES_WGSL } from './gridTypesWgsl.ts'

/** The bytes of the allocators' parameters (`VgAllocParams`). */
export const VG_ALLOC_PARAMS_BYTES = 48
/** The words of the allocators' buffer: the bottom-level cells given out, the indirection cells given out, the raster tiles made, a spare. */
export const VG_ALLOCATOR_WORDS = 4
/** The bytes of the raster tiles' parameters (`VgTileParams`). */
export const VG_TILE_PARAMS_BYTES = 16
/** The bytes of the indirect arguments' parameters (`VgArgsParams`). */
export const VG_ARGS_PARAMS_BYTES = 16
/** The groups a dimension of the wrapped dispatch of the raster tiles holds before it carries to the next. */
export const VG_WRAPPED_GROUPS = 128

/** The tile a group of the wrapped dispatch stands for (the groups' dimensions carry into the next, 128 a dimension). */
export const VG_RASTER_TILE_OF = wgslFn(
  'rasterTileOf',
  [],
  `fn rasterTileOf(block:vec3u)->u32{
 return block.x+(block.y+block.z*${VG_WRAPPED_GROUPS}u)*${VG_WRAPPED_GROUPS}u;
}`,
)

/**
 * THE BOTTOM LEVEL OF THE ORTHO GRID SIZED (`AllocateBottomLevelGrid`): each top-level cell that holds a voxel size (`topLevelGridCalculateVoxelSize`)
 * gets the cells along a side that voxel makes of its width, rounded up to a power of two. Without the indirection grid that is the
 * cell's bottom level, from one to `maxVoxelResolution` a side, the same on the three axes (the greatest), its place left empty
 * until a volume fills it. With it the cell gets an indirection grid, `resolution / maxVoxelResolution` cells a side (from one to four, the greatest of the
 * three axes), taken from the pool of indirection cells; a pool that cannot hold it is declared full and the cell has none.
 *
 * Bindings: 0 the parameters (uniform), 1 the top-level cells (storage), 2 the allocators (storage, atomic): word 1 is the indirection cells given out.
 */
export const VG_ALLOCATE_BOTTOM_LEVEL_WGSL = wgslProgram(
  `struct VgAllocParams{
 resolution:vec3i,
 indirection:i32,
 boundsMin:vec3f,
 maxVoxelResolution:i32,
 boundsMax:vec3f,
 indirectionPool:u32,
}
@group(0) @binding(0) var<uniform> params:VgAllocParams;
@group(0) @binding(1) var<storage,read_write> topLevel:array<u32>;
@group(0) @binding(2) var<storage,read_write> allocators:array<atomic<u32>>;

/** The next power of two at or over each component. */
fn nextPowerOfTwo(value:vec3i)->vec3i{
 var x=value-vec3i(1);
 x|=x>>vec3u(1u);
 x|=x>>vec3u(2u);
 x|=x>>vec3u(4u);
 x|=x>>vec3u(8u);
 x|=x>>vec3u(16u);
 return x+vec3i(1);
}

@compute @workgroup_size(4,4,4)
fn allocateBottomLevelGrid(@builtin(global_invocation_id) id:vec3u){
 if(any(vec3i(id)>=params.resolution)){return;}
 let index=vgLinearIndex(id,params.resolution);
 let word=topLevel[index];
 if(!vgIsAllocated(word)){return;}
 let cell=(params.boundsMax-params.boundsMin)/vec3f(params.resolution);
 let wanted=nextPowerOfTwo(vec3i(min(ceil(cell/vgVoxelSize(word)),vec3f(4096.0))));
 if(params.indirection!=0){
  // The indirection cells a side: the bottom level's own resolution goes into the wanted one, at least once and at most four times.
  let side=clamp(wanted/vec3i(params.maxVoxelResolution),vec3i(1),vec3i(4));
  var cells=u32(max(side.x,max(side.y,side.z)));
  let count=cells*cells*cells;
  var first=atomicAdd(&allocators[1],count);
  if(first+count>params.indirectionPool){
    atomicStore(&allocators[1],params.indirectionPool);
    first=VG_EMPTY_INDEX;
    cells=0u;
  }
  topLevel[index]=(first<<3u)|(cells&7u);
 }else{
  let side=clamp(wanted,vec3i(1),vec3i(params.maxVoxelResolution));
  topLevel[index]=(VG_EMPTY_INDEX<<3u)|(u32(max(side.x,max(side.y,side.z)))&7u);
 }
}`,
  [VG_TYPES_WGSL],
)

/**
 * THE RASTER TILES (`GenerateRasterTiles`): each non-empty top-level cell is cut into the tiles a volume is rasterized in, one group of
 * 4 x 4 x 4 voxels each: a tile for the cell, or, with the indirection grid, a tile for each of its indirection cells. A tile is the cell's
 * index and its place in the cell. A pool of tiles that cannot hold the cell's is declared full and the cell has none.
 *
 * Bindings: 0 the parameters (uniform), 1 the top-level cells (storage), 2 the allocators (storage, atomic): word 2 is the tiles made, 3 the tiles
 * (storage, two words each: the cell, the tile in it; the pool holds as many as the binding does).
 */
export const VG_GENERATE_RASTER_TILES_WGSL = wgslProgram(
  `struct VgTileParams{
 resolution:vec3i,
 indirection:i32,
}
@group(0) @binding(0) var<uniform> params:VgTileParams;
@group(0) @binding(1) var<storage,read> topLevel:array<u32>;
@group(0) @binding(2) var<storage,read_write> allocators:array<atomic<u32>>;
@group(0) @binding(3) var<storage,read_write> tiles:array<vec2u>;

@compute @workgroup_size(4,4,4)
fn generateRasterTiles(@builtin(global_invocation_id) id:vec3u){
 if(any(vec3i(id)>=params.resolution)){return;}
 let index=vgLinearIndex(id,params.resolution);
 let word=topLevel[index];
 if(vgIsBottomEmpty(word)){return;}
 let side=word&7u;
 var count=1u;
 if(params.indirection!=0){count=side*side*side;}
 if(count==0u){return;}
 let first=atomicAdd(&allocators[2],count);
 let most=arrayLength(&tiles);
 if(first+count<=most){
  for(var k=0u;k<count;k++){tiles[first+k]=vec2u(index,k);}
 }else{
  atomicStore(&allocators[2],most);
 }
}`,
  [VG_TYPES_WGSL],
)

/**
 * THE INDIRECT ARGUMENTS OF THE RASTERIZATION (`SetRasterizeBottomLevelGridIndirectArgs`): one group of 4 x 4 x 4 voxels for each tile, the count
 * wrapped onto the next dimension, 128 groups at a time, where it would pass the device's most groups in one. The count of tiles made is
 * held to the pool's size (the atomic adds of the cells can pass it) and written back.
 *
 * Bindings: 0 the parameters (uniform): the most groups of a dimension, 1 the allocators (storage, atomic), 2 the arguments (storage, three words).
 */
export const VG_RASTER_ARGS_WGSL = wgslProgram(
  `struct VgArgsParams{
 mostGroups:vec3u,
 poolSize:u32,
}
@group(0) @binding(0) var<uniform> params:VgArgsParams;
@group(0) @binding(1) var<storage,read_write> allocators:array<atomic<u32>>;
@group(0) @binding(2) var<storage,read_write> args:array<u32>;

@compute @workgroup_size(1)
fn setRasterizeBottomLevelGridIndirectArgs(){
 let count=min(atomicLoad(&allocators[2]),params.poolSize);
 atomicStore(&allocators[2],count);
 var groups=vec3u(count,1u,1u);
 if(groups.x>params.mostGroups.x){
  groups.y=(groups.x+${VG_WRAPPED_GROUPS - 1}u)/${VG_WRAPPED_GROUPS}u;
  groups.x=${VG_WRAPPED_GROUPS}u;
 }
 if(groups.y>params.mostGroups.y){
  groups.z=(groups.y+${VG_WRAPPED_GROUPS - 1}u)/${VG_WRAPPED_GROUPS}u;
  groups.y=${VG_WRAPPED_GROUPS}u;
 }
 args[0]=groups.x;
 args[1]=groups.y;
 args[2]=groups.z;
}`,
  [],
)
