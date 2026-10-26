import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { zOrderDecode } from '../../../../math/src/wgsl/integer.ts'
import { WATER_TILE_BINDINGS as T, WATER_TILE_PIXELS } from './waterLayout.ts'
import { WATER_MATH_WGSL } from './waterMathWgsl.ts'

/**
 * THE TILES THAT HOLD WATER: the target cut into tiles of `WATER_TILE_PIXELS` pixels across, a list of
 * those that hold a water pixel, and the draw of that list.
 *
 * - `csWaterMark` (one workgroup a tile, a thread a pixel): the tile holds water where a pixel's
 *   water depth is nearer than the scene's — the water's depth pass has changed it —; it sets the tile's bit
 *   in `tileMask`, a bit a tile.
 * - `csWaterList` (one workgroup of 8 by 8 threads covers 64 tiles, in Z-order so that the list keeps the
 *   screen's locality): each thread whose tile's bit is set appends the tile's coordinates (x in the low
 *   half, y in the high half of a word) to `tileList` and counts it in the instance count of the indirect
 *   draw (`args[1]`). The subgroup variant (`singleLayerWaterWaveOps`, where the device grants subgroups) takes one
 *   atomic a subgroup, its lanes writing at the prefix of the used tiles among them; the plain one takes one a tile.
 * - `csWaterIds` clears the visibility identifier of every pixel the water covers, so that the temporal pass reads
 *   the water's pixel as a surface that does not move by itself (the camera's motion alone, at the water's depth).
 * - `waterTileVertex` draws a tile of the list as two triangles, the instance picking it: the list is bound
 *   at `group`, `binding` of the module that draws it.
 */
export const waterTileVertexWgsl = (group: number, binding: number) =>
  wgslBlock(
    `waterTileVertexWgsl(${group}, ${binding})`,
    [WATER_MATH_WGSL],
    `@group(${group}) @binding(${binding}) var<storage,read> waterTiles:array<u32>;
@vertex fn waterTileVertex(@builtin(vertex_index) v:u32,@builtin(instance_index) i:u32)->@builtin(position) vec4f{
 let packed=waterTiles[i];
 let tile=vec2u(packed&0xffffu,packed>>16u);
 // The corners of the two triangles: (0,0) (1,0) (0,1), (0,1) (1,0) (1,1).
 let corner=vec2u(select(0u,1u,v==1u||v==2u||v==4u),select(0u,1u,v==2u||v==4u||v==5u));
 let pixel=vec2f((tile+corner)*${WATER_TILE_PIXELS}u);
 let size=vec2f(water.tiles.zw);
 return vec4f(pixel.x/size.x*2.0-1.0,1.0-pixel.y/size.y*2.0,0.0,1.0);
}`,
  )

/** The program text of the tiles' two kernels; `waves` the subgroup variant of the list. */
export const waterTileKernels = (waves: boolean) =>
  wgslModule(
    wgslBlock(
      `waterTileKernels(${waves})`,
      [WATER_MATH_WGSL, zOrderDecode],
      `${waves ? 'enable subgroups;\ndiagnostic(off,subgroup_uniformity);\n' : ''}@group(0) @binding(${T.params}) var<uniform> water:WaterParams;
@group(0) @binding(${T.waterDepth}) var waterDepthTexture:texture_depth_2d;
@group(0) @binding(${T.opaqueDepth}) var opaqueDepth:texture_depth_2d;
@group(0) @binding(${T.mask}) var<storage,read_write> tileMask:array<atomic<u32>>;
@group(0) @binding(${T.list}) var<storage,read_write> tileList:array<u32>;
@group(0) @binding(${T.args}) var<storage,read_write> args:array<atomic<u32>,4>;
@group(0) @binding(${T.ids}) var visIds:texture_storage_2d<r32uint,write>;
var<workgroup> holdsWater:atomic<u32>;
@compute @workgroup_size(${WATER_TILE_PIXELS},${WATER_TILE_PIXELS})
fn csWaterMark(@builtin(global_invocation_id) id:vec3u,@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_index) lane:u32){
 if(lane==0u){atomicStore(&holdsWater,0u);}
 workgroupBarrier();
 let size=water.tiles.zw;
 if(all(id.xy<size)&&textureLoad(waterDepthTexture,vec2i(id.xy),0)>textureLoad(opaqueDepth,vec2i(id.xy),0)){atomicOr(&holdsWater,1u);}
 workgroupBarrier();
 if(lane==0u&&atomicLoad(&holdsWater)!=0u){
  let at=group.y*water.tiles.x+group.x;
  atomicOr(&tileMask[at>>5u],1u<<(at&31u));
 }
}
@compute @workgroup_size(${WATER_TILE_PIXELS},${WATER_TILE_PIXELS})
fn csWaterIds(@builtin(global_invocation_id) id:vec3u){
 let at=vec2i(id.xy);
 if(all(id.xy<water.tiles.zw)&&textureLoad(waterDepthTexture,at,0)!=textureLoad(opaqueDepth,at,0)){textureStore(visIds,at,vec4u(0u));}
}
@compute @workgroup_size(${WATER_TILE_PIXELS},${WATER_TILE_PIXELS})
fn csWaterList(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_index) lane:u32){
 let tile=group.xy*${WATER_TILE_PIXELS}u+zOrderDecode(lane);
 var used=false;
 if(all(tile<water.tiles.xy)){
  let at=tile.y*water.tiles.x+tile.x;
  used=((atomicLoad(&tileMask[at>>5u])>>(at&31u))&1u)!=0u;
 }
 let packed=tile.x|(tile.y<<16u);
${
  waves
    ? ` let one=select(0u,1u,used);
 let count=subgroupAdd(one);
 let before=subgroupExclusiveAdd(one);
 var first=0u;
 if(subgroupElect()&&count>0u){first=atomicAdd(&args[1],count);}
 first=subgroupBroadcastFirst(first);
 if(used){tileList[first+before]=packed;}`
    : ` if(used){tileList[atomicAdd(&args[1],1u)]=packed;}`
}
}`,
    ),
  )
