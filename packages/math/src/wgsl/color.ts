import { wgslConst, wgslFn } from './decl.ts'
import { wgslF32 } from './number.ts'
import { byteOf } from './integer.ts'

/**
 * Colours as the shaders read and write them: a byte or three bytes of a word as a unit value, a colour's
 * luminance, and the sRGB encode, linear to display (`../color/color.ts` on the processor).
 */

/** The low three bytes of `packed`, red first, each over 255: divided, as written, never
 *  `unpack4x8unorm`, whose scale a device may round another way. */
export const unorm8x3 = wgslFn(
  'unorm8x3',
  [],
  'fn unorm8x3(packed:u32)->vec3f{return vec3f(f32(packed&255u),f32((packed>>8u)&255u),f32((packed>>16u)&255u))/255.0;}',
)

/** Byte `k` of `word` (`byteOf`) over 255, a unit value: divided, as `unorm8x3` divides. */
export const unorm8 = wgslFn(
  'unorm8',
  [byteOf],
  'fn unorm8(word:u32,k:u32)->f32{return f32(byteOf(word,k))/255.0;}',
)

/** The luminance weights of the linear sRGB primaries. */
const LUMA_WEIGHTS = wgslConst(
  'LUMA_WEIGHTS',
  [],
  `const LUMA_WEIGHTS:vec3f=vec3f(${[0.2126, 0.7152, 0.0722].map(wgslF32)});`,
)

export const luminance = wgslFn(
  'luminance',
  [LUMA_WEIGHTS],
  'fn luminance(rgb:vec3f)->f32{return dot(rgb,LUMA_WEIGHTS);}',
)

/**
 * The sRGB encode: `12.92·C` at and under 0.0031308, `1.055·C^(1/2.4) − 0.055` above, the twin of
 * the processor's `linearToSrgb`. The exponent is the `f32` nearest 1/2.4 (`wgslF32`): a rounded
 * 0.41666 strays from the definition by up to 6.2e-6 on [0, 1], this one by the `f32` rounding
 * alone (2.7e-7, `pow` included). A negative input takes the linear branch; `max` keeps the other
 * branch's `pow` defined, whose value the select drops.
 */
export const linearToSrgb = wgslFn(
  'linearToSrgb',
  [],
  `fn linearToSrgb(c:vec3f)->vec3f{
 let curve=1.055*pow(max(c,vec3f(0.0)),vec3f(${wgslF32(1 / 2.4)}))-0.055;
 return select(curve,c*12.92,c<=vec3f(0.0031308));
}`,
)
