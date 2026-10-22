import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import { PI } from '../../../../math/src/wgsl/constants.ts'
import { TAU } from '../../../../math/src/constants.ts'
import { uvToNdc } from '../../../../math/src/wgsl/projection.ts'
import { HISTORY_SHARE_MASK } from '../../visibility/types.ts'

/** The texel tile of a render-resolution pass that reads no neighbourhood network: 8 × 8. */
export const TEXEL_TILE = 8

/** The bits of the hole-filling velocity a closest occluder carries: 5 of angle, 13 of length in
 *  32nds of a pixel. */
const HOLE_FILL_BITS = 18
const HOLE_FILL_LENGTH_BITS = 13
const HOLE_FILL_ANGLE_BITS = HOLE_FILL_BITS - HOLE_FILL_LENGTH_BITS
const HOLE_FILL_LENGTH_STEPS = 32
/** An orthographic occluder's depth in 23 bits, the velocity's two halves in 9 each. */
const ORTHO_DEPTH_STEPS = 8388607

/**
 * A reprojection vector — a render texel's screen position less the one its surface had in the last
 * image, in device coordinates — in one word: each axis its signed square root, scaled to
 * `(-2, 2)` of the screen and coded in sixteen bits about the middle, so a slow motion keeps fine
 * steps (`encodeVector`, `decodeVector`: the code alone, a program of another view reads it too).
 */
export const VECTOR_CODEC_WGSL = wgslBlock(
  'VECTOR_CODEC_WGSL',
  [],
  `
fn encodeVector(v:vec2f)->u32{
 let g=sign(v)*sqrt(abs(v))*${wgslF32(2 / Math.SQRT2)};
 let e=g*${wgslF32(0.499 * 0.5)}+${wgslF32(32767 / 65535)};
 let u=vec2u(clamp(e*65535.0+0.5,vec2f(0.0),vec2f(65535.0)));
 return u.x|(u.y<<16u);
}
fn decodeVector(w:u32)->vec2f{
 let e=vec2f(f32(w&0xffffu),f32(w>>16u))*${wgslF32(1 / 65535)};
 let g=e*${wgslF32(1 / (0.499 * 0.5))}-${wgslF32(32767 / 65535 / (0.499 * 0.5))};
 return g*abs(g)*0.5;
}`,
)

/**
 * The reprojection vector in the temporal pass's view: `screenOfTexel` is a render texel centre's device
 * position, unjittered; `pixelVelocity` a device vector in render pixels, `y` down.
 */
export const REPROJECTION_VECTOR_WGSL = wgslBlock(
  'REPROJECTION_VECTOR_WGSL',
  [uvToNdc, VECTOR_CODEC_WGSL],
  `
fn screenOfTexel(p:vec2i)->vec2f{return uvToNdc((vec2f(p)+0.5)*view.render.zw);}
fn pixelVelocity(v:vec2f)->vec2f{return v*vec2f(0.5,-0.5)*view.render.xy;}
fn screenVelocity(v:vec2f)->vec2f{return v*vec2f(2.0,-2.0)*view.render.zw;}`,
)

/**
 * The hole-filling velocity a closest occluder carries in its low bits: its angle on 5 bits and its
 * length in 32nds of a pixel on 13, so a disoccluded texel can take the velocity of what covered it
 * (`reprojectWgsl.ts`); `HOLE_FILL_LENGTH_MAX`, the longest velocity coded.
 */
export const HOLE_FILL_WGSL = wgslBlock(
  'HOLE_FILL_WGSL',
  [PI],
  `
const HOLE_FILL_LENGTH_MAX:f32=${wgslF32(((1 << HOLE_FILL_LENGTH_BITS) - 1.5) / HOLE_FILL_LENGTH_STEPS)};
const HOLE_FILL_ANGLE_STEP:f32=${wgslF32(TAU / (1 << HOLE_FILL_ANGLE_BITS))};
fn encodeHoleFill(v:vec2f)->u32{
 let angle=atan2(v.y,v.x)*${wgslF32((0.5 * (1 << HOLE_FILL_ANGLE_BITS)) / Math.PI)}+${(0.5 * (1 << HOLE_FILL_ANGLE_BITS)).toFixed(1)};
 let a=u32(round(angle))&${(1 << HOLE_FILL_ANGLE_BITS) - 1}u;
 let l=u32(min(ceil(length(v)*${HOLE_FILL_LENGTH_STEPS}.0),${(1 << HOLE_FILL_LENGTH_BITS) - 1}.0));
 return a*${1 << HOLE_FILL_LENGTH_BITS}u+l;
}
/** The angle and the length of a coded velocity. */
fn decodeHoleFill(code:u32)->vec2f{
 let l=f32(code%${1 << HOLE_FILL_LENGTH_BITS}u)*${wgslF32(1 / HOLE_FILL_LENGTH_STEPS)};
 let a=f32((code>>${HOLE_FILL_LENGTH_BITS}u)%${1 << HOLE_FILL_ANGLE_BITS}u)*HOLE_FILL_ANGLE_STEP-PI;
 return vec2f(a,l);
}`,
)

/**
 * The closest occluder words (`scatterOccluder`, `reprojectWgsl.ts`), each keeping the greatest
 * written: under a perspective one word, the closest depth's half float in the high bits over the
 * hole-filling velocity's 18 (`occluderWord`, `occluderDepth`); under an orthographic projection
 * two, the depth on 23 bits in both over 9 bits of the velocity each (`orthoOccluderWords`,
 * `orthoOccluderDepth`, `orthoOccluderFill`).
 */
export const OCCLUDER_WORD_WGSL = wgslBlock(
  'OCCLUDER_WORD_WGSL',
  [],
  `
fn occluderWord(z:f32,code:u32)->u32{return ((pack2x16float(vec2f(z,0.0))&0xffffu)<<${HOLE_FILL_BITS}u)|code;}
fn occluderDepth(word:u32)->f32{return unpack2x16float(word>>${HOLE_FILL_BITS}u).x;}
fn orthoOccluderWords(z:f32,code:u32)->vec2u{
 let d=u32(clamp(round(z*${ORTHO_DEPTH_STEPS}.0),0.0,${ORTHO_DEPTH_STEPS}.0))<<9u;
 return vec2u(d|((code>>9u)&0x1ffu),d|(code&0x1ffu));
}
fn orthoOccluderDepth(word:u32)->f32{return f32(word>>9u)*${wgslF32(1 / ORTHO_DEPTH_STEPS)};}
fn orthoOccluderFill(word:u32,low:u32)->u32{return ((word&0x1ffu)<<9u)|(low&0x1ffu);}`,
)

/** The nearest velocity's targets: each render texel's closest depth in the last image (signed by
 *  its pixel animation) and its marks (reprojection edge and offset bit, depth error, moving
 *  share, offset code and history share code); and the format of a reprojection vector
 *  (`encodeVector`), which the velocity stage writes (`../velocity.ts`). */
export const CLOSEST_FORMAT: GPUTextureFormat = 'r32uint'
export const MARKS_FORMAT: GPUTextureFormat = 'rgba8uint'
/** The shift of the four bits holding the code of the most of its history the texel's surface
 *  keeps (`pageOf`, `HISTORY_SHARE_SHIFT`): above the offset code in the marks' fourth channel,
 *  which the reprojection writes into the same bits of its word, which the shading rejection
 *  writes into the same bits of its own (`resolveWgsl.ts`). */
export const SHARE_CODE_SHIFT = 4
/** Those four bits, in place. */
export const SHARE_CODE_MASK = HISTORY_SHARE_MASK << SHARE_CODE_SHIFT
export const VECTOR_FORMAT: GPUTextureFormat = 'r32uint'
