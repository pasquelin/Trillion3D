/**
 * The two conversions between a double (`double.ts`, two words) and a single-precision word,
 * each the CPU's to the bit: the exact widening and the rounding a `Float32Array` store makes.
 */
import { wgslFn } from './decl.ts'
import { dExponent, dIsNan, dNan, dSignificand, wideShiftRight } from './doubleWords.ts'

/** The double a single-precision word widens to, exactly: a subnormal becomes a normal double. The
 *  one widening of both compose passes (`gpuComposeWgsl.ts`): the motion's worlds
 *  (`gpuMotionWgsl.ts`), the rows pass's sphere centre. */
export const fromF32 = wgslFn(
  'fromF32',
  [dNan],
  `fn fromF32(w:u32)->vec2u{
 let sign=w&0x80000000u;
 let e=(w>>23u)&0xffu;
 var m=w&0x7fffffu;
 if(e==0xffu){
  if(m!=0u){return dNan();}
  return vec2u(sign|0x7ff00000u,0u);
 }
 var field=e+896u;
 if(e==0u){
  if(m==0u){return vec2u(sign,0u);}
  let shift=countLeadingZeros(m)-8u;
  m=(m<<shift)&0x7fffffu;
  field=897u-shift;
 }
 return vec2u(sign|(field<<20u)|(m>>3u),m<<29u);
}`,
)

/**
 * The single-precision bits of double `a`, rounded to nearest, ties to even, as storing it in a
 * `Float32Array` rounds it: subnormal results, overflow to infinity, a NaN as the quiet one. The
 * 53-bit significand is shifted to the result's 24 bits (fewer below the normal range), two bits
 * kept below it — the half and a sticky one folding everything lower (`wideShiftRight`).
 */
export const toF32 = wgslFn(
  'toF32',
  [dExponent, dIsNan, dSignificand, wideShiftRight],
  `fn toF32(a:vec2u)->u32{
 let sign=(a.x>>31u)<<31u;
 let e=i32(dExponent(a));
 if(e==0x7ff){return select(sign|0x7f800000u,0x7fc00000u,dIsNan(a));}
 if(e==0){return sign;}
 let biased=e-1023+127;
 let shift=select(29,30-biased,biased<1);
 let r=wideShiftRight(dSignificand(a),u32(min(shift-2,64)));
 var m=(r.y>>2u)|(r.x<<30u);
 if((r.y&2u)!=0u&&((r.y&1u)!=0u||(m&1u)!=0u)){m=m+1u;}
 if(biased<1){return sign|m;}
 var field=u32(biased);
 if(m==0x1000000u){m=0x800000u;field=field+1u;}
 if(field>=255u){return sign|0x7f800000u;}
 return sign|(field<<23u)|(m&0x7fffffu);
}`,
)
