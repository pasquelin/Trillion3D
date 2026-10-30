import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { SAMPLED_BINDINGS } from './bindings.ts'
import { SAMPLED_PARAMS_WGSL } from './paramsWgsl.ts'
import { SAMPLED_GROUP } from './layout.ts'

const B = SAMPLED_BINDINGS

/** The groups along a row of the dispatch over the layer's listed tiles: one group a tile, split in rows so that a long list stays under the limit of a dimension. */
export const FRONT_TILE_ROW = 4096

/** The listed tiles as a kernel that runs one group a tile reads them: the count, the tiles packed `x | y << 16`, and the tile of a group. */
export const FRONT_TILE_LIST_WGSL = wgslBlock(
  'SAMPLED_FRONT_TILE_LIST_WGSL',
  [],
  `@group(0) @binding(${B.tileAllocator}) var<storage,read> tileAllocator:array<u32>;
@group(0) @binding(${B.tileData}) var<storage,read> frontTileList:array<u32>;
fn listedIndex(block:vec3u)->u32{return block.y*${FRONT_TILE_ROW}u+block.x;}
fn listedTile(block:vec3u)->vec2u{
 let packed=frontTileList[listedIndex(block)];
 return vec2u(packed&0xFFFFu,packed>>16u);
}`,
)

/**
 * THE LIST OF THE TILES THE FRONT LAYER LIGHTS: a thread a tile of the view, which appends the tile to the list when the front pass marked
 * it (`frontMask`, cleared with the pass that marks it). It also clears the tile's bits, the tiles out of the list never being classified: they read as
 * empty.
 */
export const FRONT_TILE_LIST_ENTRY = 'frontTileListMain'
export const frontTileListWgsl = () =>
  wgslProgram(
    `
@group(0) @binding(${B.frontMask}) var frontMask:texture_storage_2d<r32uint,read>;
@group(0) @binding(${B.tileBitmask}) var tileBitmask:texture_storage_2d<r32uint,write>;
@group(0) @binding(${B.tileAllocator}) var<storage,read_write> tileAllocator:array<atomic<u32>>;
@group(0) @binding(${B.tileData}) var<storage,read_write> tileData:array<u32>;
@compute @workgroup_size(${SAMPLED_GROUP},${SAMPLED_GROUP},1)
fn ${FRONT_TILE_LIST_ENTRY}(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy>=params.viewTiles)){return;}
 let tile=vec2i(id.xy);
 textureStore(tileBitmask,tile,vec4u(0u));
 if(textureLoad(frontMask,tile).r!=0u){
  let at=atomicAdd(&tileAllocator[0],1u);
  tileData[at]=id.x|(id.y<<16u);
 }
}`,
    [SAMPLED_PARAMS_WGSL],
  )

/** THE ARGUMENTS OF THE DISPATCH OVER THE LISTED TILES: the groups of the rows (`FRONT_TILE_ROW`), one group a tile. */
export const FRONT_TILE_ARGS_ENTRY = 'frontTileArgsMain'
export const frontTileArgsWgsl = () =>
  wgslProgram(
    `
@group(0) @binding(${B.tileAllocator}) var<storage,read> tileAllocator:array<u32>;
@group(0) @binding(${B.tileArgs}) var<storage,read_write> tileArgs:array<u32>;
@compute @workgroup_size(1)
fn ${FRONT_TILE_ARGS_ENTRY}(){
 let count=tileAllocator[0];
 tileArgs[0]=min(count,${FRONT_TILE_ROW}u);
 tileArgs[1]=max(1u,(count+${FRONT_TILE_ROW - 1}u)/${FRONT_TILE_ROW}u);
 tileArgs[2]=1u;
}`,
    [],
  )
