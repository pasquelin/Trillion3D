import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { SURFACE_WORDS } from '../../materials/surface/surfaceOutputs.ts'
import {
  PIXEL_CLASS,
  PIXEL_TILE_CLASS_WGSL,
  TILE_CLASS,
  TILE_PIXELS,
  TILE_VERTICES,
} from './tileClass.ts'
import { VIEW_WGSL } from './worldAtWgsl.ts'

/**
 * THE CLASSIFICATION OF THE SURFACES INTO TILES: one workgroup a tile of `TILE_PIXELS` pixels
 * across, which reads the flags of its pixels (`pixelTileClass`), keeps the greatest class among
 * them, and appends its tile to the list of that class — the tile's place, a word —, counting it
 * in the instances of that class's indirect draw. A tile with no lit pixel is appended to none.
 * Its first workgroup also writes the vertex count of the three draws (`TILE_VERTICES`): the
 * counts of instances are cleared before the pass, by the encoder.
 */
export const CLASSIFY_WGSL = wgslProgram(
  `
@group(0) @binding(0) var words:texture_2d_array<u32>;
@group(0) @binding(1) var<uniform> view:View;
@group(0) @binding(2) var<storage,read_write> drawArgs:array<atomic<u32>>;
@group(0) @binding(3) var<storage,read_write> tileLists:array<u32>;
/** The classes present in the tile, a bit each: bit \`1 + class\`. */
var<workgroup> present:atomic<u32>;
@compute @workgroup_size(${TILE_PIXELS},${TILE_PIXELS},1)
fn classifyMain(@builtin(global_invocation_id) id:vec3u,@builtin(local_invocation_index) lane:u32,@builtin(workgroup_id) tile:vec3u,@builtin(num_workgroups) tiles:vec3u){
 if(lane==0u){atomicStore(&present,0u);}
 workgroupBarrier();
 if(id.x<u32(view.viewport.x)&&id.y<u32(view.viewport.y)){
  let found=pixelTileClass(textureLoad(words,vec2i(id.xy),${SURFACE_WORDS.flags},0).r);
  if(found!=${PIXEL_CLASS.none}u){atomicOr(&present,1u<<found);}
 }
 workgroupBarrier();
 if(lane!=0u){return;}
 if(tile.x==0u&&tile.y==0u){
  atomicStore(&drawArgs[0],${TILE_VERTICES}u);
  atomicStore(&drawArgs[4],${TILE_VERTICES}u);
  atomicStore(&drawArgs[8],${TILE_VERTICES}u);
 }
 let seen=atomicLoad(&present);
 if(seen==0u){return;}
 let tileClass=select(select(${TILE_CLASS.simple}u,${TILE_CLASS.single}u,(seen&${1 << PIXEL_CLASS.single}u)!=0u),${TILE_CLASS.complex}u,(seen&${1 << PIXEL_CLASS.complex}u)!=0u);
 let at=atomicAdd(&drawArgs[tileClass*4u+1u],1u);
 tileLists[tileClass*tiles.x*tiles.y+at]=(tile.y<<16u)|tile.x;
}`,
  [VIEW_WGSL, PIXEL_TILE_CLASS_WGSL],
)
