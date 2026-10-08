import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { lowBits } from '../../../../math/src/wgsl/integer.ts'

/** A double's fields — NaN, exponent, significand, scale — and the 64-bit integer steps its
 *  operations take (`doubleWgsl.ts`): sums, differences, shifts and the product of two words, each
 *  exact. */
export const DOUBLE_WORDS_WGSL = wgslBlock(
  'DOUBLE_WORDS_WGSL',
  [lowBits],
  `
fn dNan()->vec2u{return vec2u(0xffffffffu,0xffffffffu);}
fn dExponent(a:vec2u)->u32{return (a.x>>20u)&0x7ffu;}
fn dIsNan(a:vec2u)->bool{return dExponent(a)==0x7ffu&&((a.x&0xfffffu)|a.y)!=0u;}
fn dIsZero(a:vec2u)->bool{return ((a.x&0x7fffffffu)|a.y)==0u;}
/** The 53-bit significand, its leading bit written out for a normal number. */
fn dSignificand(a:vec2u)->vec2u{
 var m=vec2u(a.x&0xfffffu,a.y);
 if(dExponent(a)!=0u){m.x=m.x|0x100000u;}
 return m;
}
/** The exponent the significand is scaled by: a subnormal's is the smallest normal one's. */
fn dScale(a:vec2u)->i32{return max(i32(dExponent(a)),1);}
fn wideAdd(a:vec2u,b:vec2u)->vec2u{
 let carry=select(0u,1u,a.y>0xffffffffu-b.y);
 return vec2u((a.x+b.x+carry)&0xffffffffu,(a.y+b.y)&0xffffffffu);
}
/** \`a − b\` for \`a ≥ b\`. */
fn wideSub(a:vec2u,b:vec2u)->vec2u{
 let borrow=select(0u,1u,a.y<b.y);
 return vec2u((a.x-b.x-borrow)&0xffffffffu,(a.y-b.y)&0xffffffffu);
}
fn wideLeadingZeros(m:vec2u)->u32{
 if(m.x!=0u){return countLeadingZeros(m.x);}
 return 32u+countLeadingZeros(m.y);
}
/** \`m\` shifted left by \`n < 64\`. */
fn wideShiftLeft(m:vec2u,n:u32)->vec2u{
 if(n==0u){return m;}
 if(n>=32u){return vec2u(m.y<<(n-32u),0u);}
 return vec2u((m.x<<n)|(m.y>>(32u-n)),m.y<<n);
}
/** \`m\` shifted right by \`n\`, every bit shifted out folded into the lowest one: the sticky bit. */
fn wideShiftRight(m:vec2u,n:u32)->vec2u{
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
}
/** The 64-bit product of two words, through their 16-bit halves: no partial exceeds 32 bits. */
fn wideProduct(a:u32,b:u32)->vec2u{
 let a0=a&0xffffu;
 let a1=a>>16u;
 let b0=b&0xffffu;
 let b1=b>>16u;
 let low=a0*b0;
 let cross0=a0*b1;
 let cross1=a1*b0;
 let middle=(low>>16u)+(cross0&0xffffu)+(cross1&0xffffu);
 return vec2u(a1*b1+(cross0>>16u)+(cross1>>16u)+(middle>>16u),(low&0xffffu)|((middle&0xffffu)<<16u));
}
`,
)
