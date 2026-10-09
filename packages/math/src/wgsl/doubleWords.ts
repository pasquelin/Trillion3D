/** A double's fields — NaN, exponent, significand, scale — and the 64-bit integer steps its
 *  operations take (`double.ts`): sums, differences, shifts and the product of two words, each
 *  exact. */
import { wgslFn } from './decl.ts'
import { lowBits } from './integer.ts'

export const dNan = wgslFn('dNan', [], `fn dNan()->vec2u{return vec2u(0xffffffffu,0xffffffffu);}`)

export const dExponent = wgslFn(
  'dExponent',
  [],
  `fn dExponent(a:vec2u)->u32{return (a.x>>20u)&0x7ffu;}`,
)

export const dIsNan = wgslFn(
  'dIsNan',
  [dExponent],
  `fn dIsNan(a:vec2u)->bool{return dExponent(a)==0x7ffu&&((a.x&0xfffffu)|a.y)!=0u;}`,
)

export const dIsZero = wgslFn(
  'dIsZero',
  [],
  `fn dIsZero(a:vec2u)->bool{return ((a.x&0x7fffffffu)|a.y)==0u;}`,
)

/** The 53-bit significand, its leading bit written out for a normal number. */
export const dSignificand = wgslFn(
  'dSignificand',
  [dExponent],
  `fn dSignificand(a:vec2u)->vec2u{
 var m=vec2u(a.x&0xfffffu,a.y);
 if(dExponent(a)!=0u){m.x=m.x|0x100000u;}
 return m;
}`,
)

/** The exponent the significand is scaled by: a subnormal's is the smallest normal one's. */
export const dScale = wgslFn(
  'dScale',
  [dExponent],
  `fn dScale(a:vec2u)->i32{return max(i32(dExponent(a)),1);}`,
)

export const wideAdd = wgslFn(
  'wideAdd',
  [],
  `fn wideAdd(a:vec2u,b:vec2u)->vec2u{
 let carry=select(0u,1u,a.y>0xffffffffu-b.y);
 return vec2u((a.x+b.x+carry)&0xffffffffu,(a.y+b.y)&0xffffffffu);
}`,
)

/** `a − b` for `a ≥ b`. */
export const wideSub = wgslFn(
  'wideSub',
  [],
  `fn wideSub(a:vec2u,b:vec2u)->vec2u{
 let borrow=select(0u,1u,a.y<b.y);
 return vec2u((a.x-b.x-borrow)&0xffffffffu,(a.y-b.y)&0xffffffffu);
}`,
)

export const wideLeadingZeros = wgslFn(
  'wideLeadingZeros',
  [],
  `fn wideLeadingZeros(m:vec2u)->u32{
 if(m.x!=0u){return countLeadingZeros(m.x);}
 return 32u+countLeadingZeros(m.y);
}`,
)

/** `m` shifted left by `n < 64`. */
export const wideShiftLeft = wgslFn(
  'wideShiftLeft',
  [],
  `fn wideShiftLeft(m:vec2u,n:u32)->vec2u{
 if(n==0u){return m;}
 if(n>=32u){return vec2u(m.y<<(n-32u),0u);}
 return vec2u((m.x<<n)|(m.y>>(32u-n)),m.y<<n);
}`,
)

/** `m` shifted right by `n`, every bit shifted out folded into the lowest one: the sticky bit. */
export const wideShiftRight = wgslFn(
  'wideShiftRight',
  [lowBits],
  `fn wideShiftRight(m:vec2u,n:u32)->vec2u{
 if(n==0u){return m;}
 if(n>=64u){return vec2u(0u,select(0u,1u,(m.x|m.y)!=0u));}
 var out=vec2u(0u,0u);
 var lost=0u;
 if(n>=32u){
  let s=n-32u;
  out=vec2u(0u,m.x>>s);
  lost=m.y|(m.x&lowBits(s));
 }else{
  out=vec2u(m.x>>n,(m.y>>n)|(m.x<<(32u-n)));
  lost=m.y&lowBits(n);
 }
 if(lost!=0u){out.y=out.y|1u;}
 return out;
}`,
)
