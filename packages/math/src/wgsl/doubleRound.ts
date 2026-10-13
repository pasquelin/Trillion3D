/**
 * A double's integer roundings and its conversions with a word, on the GPU, each the CPU's to the
 * bit (`double.ts`'s representation, two words): `Math.trunc`, `Math.floor`, `Math.ceil`, the exact
 * widening of an unsigned word, and the word of a non-negative integer below 2^32. A rounding
 * clears the bits of the significand below the unit, or gives a signed zero below one; a value of
 * 2^52 or more, an infinity and a NaN are their own rounding. Floor and ceil step one unit away
 * from the truncation when it dropped a fraction, which is exact below 2^52.
 */
import { wgslFn } from './decl.ts'
import { dExponent, dSignificand, wideShiftLeft, wideShiftRight } from './doubleWords.ts'
import { dAdd } from './double.ts'
import { lowBits } from './integer.ts'

/** `Math.trunc(a)`: toward zero, the sign of a zero kept. */
export const dTrunc = wgslFn(
  'dTrunc',
  [dExponent, lowBits],
  `fn dTrunc(a:vec2u)->vec2u{
 let e=dExponent(a);
 if(e>=1075u){return a;}
 if(e<1023u){return vec2u(a.x&0x80000000u,0u);}
 let f=1075u-e;
 if(f>=32u){return vec2u(a.x&~lowBits(f-32u),0u);}
 return vec2u(a.x,a.y&~lowBits(f));
}`,
)

/** `Math.floor(a)`: a negative value with a fraction one below its truncation. */
export const dFloor = wgslFn(
  'dFloor',
  [dTrunc, dAdd],
  `fn dFloor(a:vec2u)->vec2u{
 let t=dTrunc(a);
 if((a.x>>31u)==0u||(t.x==a.x&&t.y==a.y)){return t;}
 return dAdd(t,vec2u(0xbff00000u,0u));
}`,
)

/** `Math.ceil(a)`: a positive value with a fraction one above its truncation; `-0.5` gives `-0`. */
export const dCeil = wgslFn(
  'dCeil',
  [dTrunc, dAdd],
  `fn dCeil(a:vec2u)->vec2u{
 let t=dTrunc(a);
 if((a.x>>31u)!=0u||(t.x==a.x&&t.y==a.y)){return t;}
 return dAdd(t,vec2u(0x3ff00000u,0u));
}`,
)

/** `Number.isFinite(a)`: neither an infinity nor a NaN. */
export const dIsFinite = wgslFn(
  'dIsFinite',
  [dExponent],
  `fn dIsFinite(a:vec2u)->bool{return dExponent(a)!=0x7ffu;}`,
)

/** The double an unsigned word is, exactly: its leading bit brought to the significand's 52nd. */
export const dFromU32 = wgslFn(
  'dFromU32',
  [wideShiftLeft],
  `fn dFromU32(n:u32)->vec2u{
 if(n==0u){return vec2u(0u,0u);}
 let zeros=countLeadingZeros(n);
 let m=wideShiftLeft(vec2u(0u,n),21u+zeros);
 return vec2u(((1054u-zeros)<<20u)|(m.x&0xfffffu),m.y);
}`,
)

/** The word of `a`, a non-negative integer below 2^32 (a rect's pixel): its significand shifted
 *  down to the unit, no bit lost. */
export const dToU32 = wgslFn(
  'dToU32',
  [dExponent, dSignificand, wideShiftRight],
  `fn dToU32(a:vec2u)->u32{
 let e=dExponent(a);
 if(e<1023u){return 0u;}
 return wideShiftRight(dSignificand(a),1075u-e).y;
}`,
)
