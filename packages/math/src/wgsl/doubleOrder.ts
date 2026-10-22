/**
 * Extrema of two doubles as JavaScript gives them, a NaN included, on the GPU (`double.ts`'s
 * representation): `Math.min` and `Math.max` a NaN whenever one is. `dMin` and `dMax` hold for
 * numbers that are no NaN; these hold for any, so a bound computed from a non-finite input stays
 * non-finite, as on the CPU.
 */
import { wgslFn } from './decl.ts'
import { dIsNan, dNan } from './doubleWords.ts'
import { dMax, dMin } from './double.ts'

/** `Math.min(a, b)`: a NaN if either is one, `-0` the smaller zero. */
export const dMathMin = wgslFn(
  'dMathMin',
  [dIsNan, dNan, dMin],
  `fn dMathMin(a:vec2u,b:vec2u)->vec2u{
 if(dIsNan(a)||dIsNan(b)){return dNan();}
 return dMin(a,b);
}`,
)

/** `Math.max(a, b)`: a NaN if either is one, `+0` the larger zero. */
export const dMathMax = wgslFn(
  'dMathMax',
  [dIsNan, dNan, dMax],
  `fn dMathMax(a:vec2u,b:vec2u)->vec2u{
 if(dIsNan(a)||dIsNan(b)){return dNan();}
 return dMax(a,b);
}`,
)
