import { wgslFn } from './decl.ts'

/**
 * Integer counts and powers of two, as the shaders write them (`../scalar/integers.ts` on the
 * processor). Unsigned arithmetic wraps modulo 2³² and rounds nothing, so a sum written `a+31u` or
 * `a+32u-1u`, a quotient by 32 written `/32u` or `>>5u`, gives the same word: these hold one text
 * each, the integer value being the same whatever the spelling.
 */

/** The groups of `n` that `a` takes, the last one part full (`ceilDiv`); `a+n-1u` wraps past
 *  2³² − n, as every site's sum did. */
export const ceilDiv = wgslFn('ceilDiv', [], 'fn ceilDiv(a:u32,n:u32)->u32{return (a+n-1u)/n;}')

/** The bits that hold `x`: 0 for 0, 32 from 2³¹ on. */
export const bitLength = wgslFn(
  'bitLength',
  [],
  'fn bitLength(x:u32)->u32{return 32u-countLeadingZeros(x);}',
)

/** The exponent of the greatest power of two not over `x` (`floorLog2`); 0 gives 0xffffffff, the
 *  word of the processor's −1 and of `firstLeadingBit(0u)`. */
export const floorLog2 = wgslFn(
  'floorLog2',
  [],
  'fn floorLog2(x:u32)->u32{return 31u-countLeadingZeros(x);}',
)

/** 2^`exponent`, exact, built from its exponent bits: `exponent` in [−126, 127], a normal `f32`. */
export const pow2FromExponent = wgslFn(
  'pow2FromExponent',
  [],
  'fn pow2FromExponent(exponent:i32)->f32{return bitcast<f32>(u32(exponent+127)<<23u);}',
)
