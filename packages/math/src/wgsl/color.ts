import { wgslConst, wgslFn } from './decl.ts'
import { wgslF32 } from './number.ts'
import { byteOf } from './integer.ts'
import {
  SRGB_DECODE_THRESHOLD,
  SRGB_ENCODE_THRESHOLD,
  SRGB_GAMMA,
  SRGB_OFFSET,
  SRGB_SCALE,
  SRGB_SLOPE,
} from '../color/color.ts'

/**
 * Colours as the shaders read and write them: a byte of a word as a unit value, a
 * colour's luminance, and the sRGB encode, linear to display (`../color/color.ts` on the processor).
 */

/** Byte `k` of `word` (`byteOf`) over 255, a unit value: divided, as written, never
 *  `unpack4x8unorm`, whose scale a device may round another way. */
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
 let curve=${SRGB_SCALE}*pow(max(c,vec3f(0.0)),vec3f(${wgslF32(1 / SRGB_GAMMA)}))-${SRGB_OFFSET};
 return select(curve,c*${SRGB_SLOPE},c<=vec3f(${SRGB_ENCODE_THRESHOLD}));
}`,
)

/**
 * The sRGB decode: `C / 12.92` at and under 0.04045, `((C + 0.055) / 1.055)^2.4` above, the twin of
 * the processor's `srgbToLinear`. A negative input takes the linear branch; `max` keeps the other
 * branch's `pow` defined, whose value the select drops.
 */
export const srgbToLinear = wgslFn(
  'srgbToLinear',
  [],
  `fn srgbToLinear(c:vec3f)->vec3f{
 let curve=pow((max(c,vec3f(0.0))+vec3f(${SRGB_OFFSET}))/${SRGB_SCALE},vec3f(${SRGB_GAMMA}));
 return select(curve,c/${SRGB_SLOPE},c<=vec3f(${SRGB_DECODE_THRESHOLD}));
}`,
)
