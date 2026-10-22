/**
 * Whether a double is finite on the GPU (`double.ts`'s representation, two words), as
 * `Number.isFinite`: neither an infinity nor a NaN.
 */
import { wgslFn } from './decl.ts'
import { dExponent } from './doubleWords.ts'

/** `Number.isFinite(a)`: neither an infinity nor a NaN. */
export const dIsFinite = wgslFn(
  'dIsFinite',
  [dExponent],
  `fn dIsFinite(a:vec2u)->bool{return dExponent(a)!=0x7ffu;}`,
)
