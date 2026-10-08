import { wgslFn } from './decl.ts'

/**
 * Integer counts and powers of two, bit sets, the bytes of a word and the class of a float's bits,
 * as the shaders write them (`../scalar/integers.ts` on the processor). Unsigned arithmetic wraps
 * modulo 2³² and rounds nothing, so a sum written `a+31u` or `a+32u-1u`, a quotient by 32 written
 * `/32u` or `>>5u`, a bit tested `(w>>i)&1u` or `w&(1u<<i)`, gives the same word: these hold one
 * text each, the integer value being the same whatever the spelling.
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

/** The word of a bit set that holds bit `i`, `i/32` (`bitWords` counts them on the processor). */
export const bitWord = wgslFn('bitWord', [], 'fn bitWord(i:u32)->u32{return i>>5u;}')

/** Bit `i`'s mask within its word, `1 << (i mod 32)`. */
export const bitMask = wgslFn('bitMask', [], 'fn bitMask(i:u32)->u32{return 1u<<(i&31u);}')

/** The `n` lowest bits set, `2^n - 1`, for `n` in [0, 31]; `n = 32` gives 0 (`1u << 32u` is `1u`). */
export const lowBits = wgslFn('lowBits', [], 'fn lowBits(n:u32)->u32{return (1u<<n)-1u;}')

/** The cell `i` of a rectangle `size` wide that starts at `rect.xy`, in row-major order: the row is
 *  read from `(i + 0.5) / size.x` in `f32`. */
export const rectCell = wgslFn(
  'rectCell',
  [],
  `fn rectCell(rect:vec4u,size:vec2u,i:u32)->vec2u{
 let y=u32(floor((f32(i)+0.5)/f32(size.x)));
 return rect.xy+vec2u(i-size.x*y,y);
}`,
)

/** Bit `i` of `word` (`i` taken modulo 32), 0 or 1. */
export const bitAt = wgslFn(
  'bitAt',
  [],
  'fn bitAt(word:u32,i:u32)->u32{return (word>>(i&31u))&1u;}',
)

/** Whether bit `i` of `word` (`i` taken modulo 32) is set. */
export const bitIsSet = wgslFn(
  'bitIsSet',
  [bitAt],
  'fn bitIsSet(word:u32,i:u32)->bool{return bitAt(word,i)!=0u;}',
)

/** Byte `k` of `word`, the lowest first: `k` from 0 to 3. */
export const byteOf = wgslFn(
  'byteOf',
  [],
  'fn byteOf(word:u32,k:u32)->u32{return (word>>(8u*k))&255u;}',
)

/** Whether the `f32` of bits `word` is a NaN: its magnitude bits past the infinity's. */
export const isNanWord = wgslFn(
  'isNanWord',
  [],
  'fn isNanWord(word:u32)->bool{return (word&0x7fffffffu)>0x7f800000u;}',
)

/** Whether the `f32` of bits `word` is finite: its exponent bits not all set. A compiler may assume
 *  no infinity nor NaN in float arithmetic; the bits decide whatever it assumes. */
export const isFiniteWord = wgslFn(
  'isFiniteWord',
  [],
  'fn isFiniteWord(word:u32)->bool{return (word&0x7f800000u)!=0x7f800000u;}',
)

/** The 64-bit product of two words, through their 16-bit halves: no partial exceeds 32 bits. */
export const wideProduct = wgslFn(
  'wideProduct',
  [],
  `fn wideProduct(a:u32,b:u32)->vec2u{
 let a0=a&0xffffu;
 let a1=a>>16u;
 let b0=b&0xffffu;
 let b1=b>>16u;
 let low=a0*b0;
 let cross0=a0*b1;
 let cross1=a1*b0;
 let middle=(low>>16u)+(cross0&0xffffu)+(cross1&0xffffu);
 return vec2u(a1*b1+(cross0>>16u)+(cross1>>16u)+(middle>>16u),(low&0xffffu)|((middle&0xffffu)<<16u));
}`,
)

/** The low 16 bits of `word`: a pair of halves packed `low | high << 16`, its first. */
export const lowHalf = wgslFn('lowHalf', [], 'fn lowHalf(word:u32)->u32{return word&0xffffu;}')

/** The high 16 bits of `word`: a pair of halves packed `low | high << 16`, its second. */
export const highHalf = wgslFn('highHalf', [], 'fn highHalf(word:u32)->u32{return word>>16u;}')
