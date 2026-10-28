import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { rand3dPcg16 } from '../../../../../math/src/wgsl/sampling.ts'
import { ditherLight, packLight } from '../../../gpu/core/smallFloatWgsl.ts'
import {
  lightStoreDeps,
  lightTexel,
  type LightAtlasFormat,
} from '../../../gpu/core/lightAtlasFormat.ts'

/**
 * WHAT EVERY PROGRAM OF THE DIRECT UPDATE'S TILES SHARES (`directWgsl.ts`, `stochasticWgsl.ts`): the texel a thread starts from, the lights
 * its tile keeps, and the write of its light into the direct layer. The program binds the common text, the surface texel and the context
 * beside.
 */

/** The bindings of the tiles' lights and of where each tile's begin in them. */
export interface DirectTileBindings {
  readonly cardTileLights: number
  readonly cardTileOffsets: number
}

/**
 * `directTexel(tile, at)`: the tile of the list `tile` (its page and its place in it), its texel `at`, and the lights the tile keeps — none where the
 * direct light is off — from `first` in the tiles' lights; `tileLightWord(head, k)` is the word of light `k` of the tile (its rank and whether the
 * atlas holds no slot of its function) and `tileLightMask(head, k)` the place of its light tile in the compacted list, the index of its mask.
 */
export const directTexelWgsl = (b: DirectTileBindings) =>
  wgslBlock(
    `DIRECT_TEXEL_WGSL(${b.cardTileLights},${b.cardTileOffsets})`,
    [],
    `@group(0) @binding(${b.cardTileLights}) var<storage,read> cardTileLights:array<u32>;
@group(0) @binding(${b.cardTileOffsets}) var<storage,read> cardTileOffsets:array<u32>;
struct DirectTexel{page:u32,coord:vec2u,texel:SurfaceTexel,first:u32,lights:u32}
fn directTexel(tile:u32,at:vec2u)->DirectTexel{
 let packed=ctxTile(LG_LIST_DIRECT,tile);
 let page=tilePage(packed);
 let coord=tileCoordOf(packed);
 let first=cardTileOffsets[tile*CARD_TILE_OFFSET_WORDS];
 return DirectTexel(page,coord,surfaceTexel(page,coord*LG_TILE+at),first,select(0u,cardTileOffsets[tile*CARD_TILE_OFFSET_WORDS+1u],lgFlag(FLAG_DIRECT)));
}
fn tileLightWord(head:DirectTexel,k:u32)->u32{return cardTileLights[(head.first+k)*LIGHT_TILE_WORDS];}
fn tileLightMask(head:DirectTexel,k:u32)->u32{return cardTileLights[(head.first+k)*LIGHT_TILE_WORDS+1u];}`,
  )

/** `storeDirect(page, texel, irradiance)`: writes the light of the texel into the layer bound at `out`, stored in `light`, kept multiplied by the pre-exposure and, in the 11-11-10 format, dithered by a hash of the texel and the page's image. */
export const storeDirectWgsl = (out: number, light: LightAtlasFormat) =>
  wgslBlock(
    `STORE_DIRECT_WGSL(${out},${light})`,
    [packLight, ditherLight, rand3dPcg16, ...lightStoreDeps(light)],
    `@group(0) @binding(${out}) var outDirect:texture_storage_2d<${light},write>;
fn storeDirect(page:u32,texel:SurfaceTexel,irradiance:vec3f){
 let seed=vec3i(i32(texel.atlas.x),i32(texel.atlas.y),i32(scPageW(page,18u)));
 let noise=f32(rand3dPcg16(seed).x)/65536.0;
 textureStore(outDirect,vec2i(texel.atlas),${lightTexel(light, 'irradiance*lp.preExposure', 'noise')});
}`,
  )
