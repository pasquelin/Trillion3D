import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import {
  PLACE_AXIS_BITS,
  PLACE_LAYER_BITS,
  POOL_STEP,
  POOL_SUBTEXEL,
  TILE_PITCH,
} from '../../texture/tiles.ts'
import { TILE_BORDER, TILE_SIZE } from '../../../../sdk-core/src/contracts/writtenFormats.ts'

/** A place's column-or-row and layer fields in a table word (`packPlace`). */
const AXIS_MASK = (1 << PLACE_AXIS_BITS) - 1,
  LAYER_MASK = (1 << PLACE_LAYER_BITS) - 1

/**
 * WHERE A TAP READS IN THE POOL: the place a table word names — column, row, layer —, a tail
 * level's offset in its tile, and the pool coordinate of a texel there (`TileTap`), which the
 * hardware sampler filters as it filtered the texel in the texture's own chain.
 *
 * A pool coordinate holds 2^-24 of a layer at most — `POOL_SUBTEXEL` steps a texel —, finer than
 * the sampler's sub-texel weights. The tap TRUNCATES the in-tile position to that grid (`poolAxis`)
 * where a sum `origin + texel` would round it: each sub-texel weight the hardware takes from a
 * coordinate on a coarser power-of-two grid — 8 bits or more — is then the one it takes from the
 * texel's own coordinate in the level, rounded or truncated alike, wherever the streamer placed
 * the tile. A rounded position crossed a weight's step for one position in 32: the 8-bit image
 * of a whole-level read moved by a step there (`poolCoordinate.test.ts`).
 */
export const POOL_PLACE_WGSL = wgslBlock(
  'POOL_PLACE_WGSL',
  [],
  `const TEXEL_PITCH:f32=${wgslF32(TILE_PITCH)};
const TEXEL_BORDER:f32=${wgslF32(TILE_BORDER)};
const POOL_SUBTEXEL:f32=${wgslF32(POOL_SUBTEXEL)};
const POOL_STEP:f32=1.0/${wgslF32(1 / POOL_STEP)};
struct TileTap{uv:vec2f,layer:i32,}
/** Pool coordinate of a texel at \`texel\` from a tile's \`origin\`, counted in 2^-24 steps, the
 *  in-tile position truncated: exact in f32 at every place (\`POOL_LAYER_SIDE\`,
 *  \`../../texture/tiles.ts\`), with no division. */
fn poolAxis(origin:f32,texel:f32)->f32{return (origin*POOL_SUBTEXEL+floor(texel*POOL_SUBTEXEL))*POOL_STEP;}
fn poolTap(origin:vec2f,texel:vec2f,layer:i32)->TileTap{return TileTap(vec2f(poolAxis(origin.x,texel.x),poolAxis(origin.y,texel.y)),layer);}
fn tailOffset(rank:u32)->f32{return f32((${TILE_SIZE}u-(${TILE_SIZE}u>>rank)+3u)&~3u);}
/** The one decoder of a place in a table word (\`packPlace\`): its column, row and layer. */
fn placeFields(word:u32)->vec3u{return vec3u(word&${AXIS_MASK}u,(word>>${PLACE_AXIS_BITS}u)&${AXIS_MASK}u,(word>>${2 * PLACE_AXIS_BITS}u)&${LAYER_MASK}u);}
fn placeOrigin(word:u32)->vec2f{return vec2f(placeFields(word).xy)*TEXEL_PITCH+TEXEL_BORDER;}
fn placeLayer(word:u32)->i32{return i32(placeFields(word).z);}`,
)
