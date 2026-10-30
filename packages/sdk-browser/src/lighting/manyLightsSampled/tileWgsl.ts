import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { SURFACE_WORDS } from '../../materials/surface/surfaceOutputs.ts'
import { DEFERRED_BINDINGS } from '../deferred/bindings.ts'
import {
  DEPTH_BINDING_WGSL,
  VIEW_BINDING_WGSL,
  WORDS_BINDING_WGSL,
} from '../deferred/litSurfaceWgsl.ts'
import { LIGHTS_BINDING_WGSL } from '../deferred/lightPassWgsl.ts'
import { PIXEL_CLASS, PIXEL_TILE_CLASS_WGSL } from '../deferred/tileClass.ts'
import { DIRECT_LIGHT_WGSL } from '../direct/lightWgsl.ts'
import { TILE_SLICE_WGSL, pixelCellWgsl } from '../direct/lightingWgsl.ts'
import { SAMPLED_BINDINGS } from './bindings.ts'
import { SAMPLED_PARAMS_WGSL } from './paramsWgsl.ts'
import { SAMPLED_GROUP } from './layout.ts'
import { SAMPLED_TILE, SAMPLED_TILE_MODES } from './parameters.ts'
import { FRONT_TILE_LIST_WGSL } from './frontTilesWgsl.ts'

/** The bits of a tile of the view: which classes of surface its pixels are, and whether a rectangle light reaches it. */
const TILE_BIT = {
  simple: 0x01,
  single: 0x02,
  complex: 0x04,
  rect: 0x10,
  texturedRect: 0x20,
} as const
/** The light grid's lists as the tile kernel reads them. */
const TILES_BINDING_WGSL = wgslBlock(
  'SAMPLED_TILES_BINDING_WGSL',
  [],
  `@group(0) @binding(${DEFERRED_BINDINGS.tiles}) var<storage,read> tileLights:array<u32>;`,
)

const B = SAMPLED_BINDINGS

/** The bits of a tile, as the kernels name them. */
const TILE_BITS_WGSL = wgslBlock(
  'SAMPLED_TILE_BITS_WGSL',
  [],
  `const BIT_SIMPLE:u32=${TILE_BIT.simple}u;
const BIT_SINGLE:u32=${TILE_BIT.single}u;
const BIT_COMPLEX:u32=${TILE_BIT.complex}u;
const BIT_RECT:u32=${TILE_BIT.rect}u;
const BIT_TEXTURED:u32=${TILE_BIT.texturedRect}u;
const TILE_MODES:u32=${SAMPLED_TILE_MODES}u;
const MODE_EMPTY:u32=${SAMPLED_TILE.empty}u;
const NO_MODE:u32=0xFFu;`,
)

/**
 * THE BITS OF EACH TILE OF THE VIEW: one group a tile of eight pixels across, a thread a pixel, which reads the class of its surface
 * (`pixelTileClass`: simple, single or complex) and whether a rectangle light is in the list of its cell of the light grid, and
 * writes the union of them as the tile's word (`TILE_BIT`). With `listed` (the nearest translucent layer), a group is a tile of the list the front pass's
 * marks made (`frontTilesWgsl.ts`), the dispatch indirect over it: the tiles the pass did not mark are not classified.
 */
export const TILE_BITMASK_ENTRY = 'tileBitmaskMain'
export const tileBitmaskWgsl = (listed = false) =>
  wgslProgram(
    `
@group(0) @binding(${B.tileBitmask}) var tileBitmask:texture_storage_2d<r32uint,write>;
var<workgroup> tileBits:atomic<u32>;
@compute @workgroup_size(${SAMPLED_GROUP},${SAMPLED_GROUP},1)
${
  listed
    ? `fn ${TILE_BITMASK_ENTRY}(@builtin(local_invocation_id) inTile:vec3u,@builtin(local_invocation_index) lane:u32,@builtin(workgroup_id) block:vec3u){
 let live=listedIndex(block)<tileAllocator[0];
 let tile=listedTile(block);
 let id=tile*${SAMPLED_GROUP}u+inTile.xy;`
    : `fn ${TILE_BITMASK_ENTRY}(@builtin(global_invocation_id) id:vec3u,@builtin(local_invocation_index) lane:u32,@builtin(workgroup_id) tile:vec3u){`
}
 if(lane==0u){atomicStore(&tileBits,0u);}
 workgroupBarrier();
 if(${listed ? 'live&&' : ''}id.x<u32(view.viewport.x)&&id.y<u32(view.viewport.y)){
  let coord=vec2i(id.xy);
  let found=pixelTileClass(textureLoad(words,coord,${SURFACE_WORDS.flags},0).r);
  if(found!=${PIXEL_CLASS.none}u){
   var bits=select(select(BIT_SIMPLE,BIT_SINGLE,found==${PIXEL_CLASS.single}u),BIT_COMPLEX,found==${PIXEL_CLASS.complex}u);
   let cell=cellSlice(pixelCell(vec2f(id.xy)+vec2f(0.5),textureLoad(depth,coord,0)));
   for(var index=0u;index<cell.y;index++){
    let rank=listedLight(cell,index);
    if(listedDrawn(cell,rank)&&sampledTakes(rank)&&isRect(directLights.items[rank])){bits|=BIT_RECT;break;}
   }
   atomicOr(&tileBits,bits);
  }
 }
 workgroupBarrier();
 if(${listed ? 'lane==0u&&live' : 'lane==0u'}){textureStore(tileBitmask,${listed ? 'vec2i(tile)' : 'vec2i(tile.xy)'},vec4u(atomicLoad(&tileBits),0u,0u,0u));}
}`,
    [
      TILE_BITS_WGSL,
      DIRECT_LIGHT_WGSL,
      TILE_SLICE_WGSL,
      pixelCellWgsl(),
      VIEW_BINDING_WGSL,
      WORDS_BINDING_WGSL,
      DEPTH_BINDING_WGSL,
      PIXEL_TILE_CLASS_WGSL,
      LIGHTS_BINDING_WGSL,
      TILES_BINDING_WGSL,
      ...(listed ? [FRONT_TILE_LIST_WGSL] : []),
    ],
  )

/**
 * THE LISTS OF TILES BY MODE: one group of eight by eight threads a block of tiles, a thread a tile of the view (`DOWNSAMPLED` 0) or of the
 * downsampled view (1: the union of the bits of the `factor` tiles it covers). The thread finds its mode (`modeOfBits`) and appends its tile,
 * packed `x | y << 16`, to the list of that mode, after counting it in `tileAllocator`. With `fastClear`, an empty tile with no shaded tile
 * around it is left out of every list. The order of a list is that of the atomics, not of the tiles: the passes over a list do not depend on it.
 */
export const TILE_LISTS_ENTRY = 'tileListsMain'
export const tileListsWgsl = () =>
  wgslProgram(
    `
override DOWNSAMPLED:u32=0u;
@group(0) @binding(${B.tileBitmask}) var tileBitmask:texture_2d<u32>;
@group(0) @binding(${B.tileAllocator}) var<storage,read_write> tileAllocator:array<atomic<u32>>;
@group(0) @binding(${B.tileData}) var<storage,read_write> tileData:array<u32>;
fn buildMode(bits:u32,simple:u32,rect:u32,textured:u32)->u32{
 if((bits&BIT_RECT)==0u){return simple;}
 return select(rect,textured,(bits&BIT_TEXTURED)!=0u&&params.textured!=0u);
}
fn modeOfBits(bits:u32)->u32{
 if((bits&BIT_COMPLEX)!=0u){return buildMode(bits,${SAMPLED_TILE.complex}u,${SAMPLED_TILE.complexRect}u,${SAMPLED_TILE.complexRectTextured}u);}
 if((bits&BIT_SINGLE)!=0u){return buildMode(bits,${SAMPLED_TILE.single}u,${SAMPLED_TILE.singleRect}u,${SAMPLED_TILE.singleRectTextured}u);}
 if((bits&BIT_SIMPLE)!=0u){return buildMode(bits,${SAMPLED_TILE.simple}u,${SAMPLED_TILE.simpleRect}u,${SAMPLED_TILE.simpleRectTextured}u);}
 return MODE_EMPTY;
}
fn gridTiles()->vec2u{return select(params.viewTiles,params.downTiles,DOWNSAMPLED==1u);}
/** The mode of the tile 't' of the grid, 'NO_MODE' outside it. */
fn tileModeAt(t:vec2i)->u32{
 if(any(t<vec2i(0))||any(vec2u(t)>=gridTiles())){return NO_MODE;}
 if(DOWNSAMPLED==0u){return modeOfBits(textureLoad(tileBitmask,t,0).r);}
 var merged=0u;
 for(var y=0u;y<params.factor.y;y++){
  for(var x=0u;x<params.factor.x;x++){
   let source=vec2u(t)*params.factor+vec2u(x,y);
   if(all(source<params.viewTiles)){merged|=textureLoad(tileBitmask,vec2i(source),0).r;}
  }
 }
 return modeOfBits(merged);
}
@compute @workgroup_size(${SAMPLED_GROUP},${SAMPLED_GROUP},1)
fn ${TILE_LISTS_ENTRY}(@builtin(workgroup_id) block:vec3u,@builtin(local_invocation_id) lane:vec3u){
 let tile=block.xy*${SAMPLED_GROUP}u+lane.xy;
 var mode=tileModeAt(vec2i(tile));
 if(mode==NO_MODE){return;}
 if(params.fastClear!=0u&&mode==MODE_EMPTY){
  var near=false;
  for(var oy=-1;oy<=1;oy++){
   for(var ox=-1;ox<=1;ox++){
    let around=tileModeAt(vec2i(tile)+vec2i(ox,oy));
    if(around!=NO_MODE&&around!=MODE_EMPTY){near=true;}
   }
  }
  if(!near){return;}
 }
 let at=atomicAdd(&tileAllocator[mode],1u);
 tileData[mode*params.stride+at]=tile.x|(tile.y<<16u);
}`,
    [TILE_BITS_WGSL, SAMPLED_PARAMS_WGSL],
  )

/**
 * THE ARGUMENTS OF THE DISPATCHES OVER THE LISTS: a thread a mode, which writes the groups of the indirect dispatch over that mode's tiles,
 * one group a tile (`count`, 1, 1).
 */
export const TILE_ARGS_ENTRY = 'tileArgsMain'
export const tileArgsWgsl = () =>
  wgslProgram(
    `
@group(0) @binding(${B.tileAllocator}) var<storage,read> tileAllocator:array<u32>;
@group(0) @binding(${B.tileArgs}) var<storage,read_write> tileArgs:array<u32>;
@compute @workgroup_size(16,1,1)
fn ${TILE_ARGS_ENTRY}(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=TILE_MODES){return;}
 tileArgs[id.x*3u]=tileAllocator[id.x];
 tileArgs[id.x*3u+1u]=1u;
 tileArgs[id.x*3u+2u]=1u;
}`,
    [TILE_BITS_WGSL],
  )
