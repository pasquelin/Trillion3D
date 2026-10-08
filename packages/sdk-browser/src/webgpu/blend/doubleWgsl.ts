import { DOUBLE_WORDS_WGSL } from './doubleWordsWgsl.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { lowBits, wideProduct } from '../../../../math/src/wgsl/integer.ts'
/**
 * DOUBLE-PRECISION ARITHMETIC ON THE GPU, IN INTEGERS.
 *
 * WGSL has no 64-bit float, and the transparent paint order is decided on doubles (`order.ts`): the
 * GPU must reach the CPU's keys to the bit, or two items whose keys differ only in their last bits
 * would swap. A double is held as its IEEE bits, `vec2u(high word, low word)`, and each operation
 * rounds once, to nearest, ties to even, subnormals and infinities included: the result IS the
 * CPU's, not an approximation of it.
 *
 * Every intermediate is an exact integer below 2^33, masked back to 32 bits where a carry may leave
 * it, and no product of two words exceeds 32 bits (16-bit halves): the same text then runs as is in
 * `shaderRun`, whose integers are JavaScript doubles, which is how the tests compare it with the CPU
 * bit for bit.
 *
 * A NaN result is the one pattern of all ones: as an unsigned 64-bit number it lies above +∞, which
 * is where the order ranks a NaN key (`paintOrder.ts`, `precedes`). The other keys are squares and
 * sums of squares, never negative, so their bits compare as the numbers do.
 */
export const DOUBLE_WGSL = wgslBlock(
  'DOUBLE_WGSL',
  [DOUBLE_WORDS_WGSL, lowBits, wideProduct],
  `
/**
 * The double nearest \`m·2^(scale−1078)\`, ties to even. \`m\` carries the significand and three bits
 * below it — guard, round, and a sticky bit folding everything lower —, its leading bit at 55 for a
 * normal result; a scale below one first shifts it into the subnormal range, so the value is
 * rounded once.
 */
fn dRound(sign:u32,scale:i32,m:vec2u)->vec2u{
 var e=scale;
 var s=m;
 if(e<1){
  s=wideShiftRight(s,u32(1-e));
  e=1;
 }
 let below=s.y&7u;
 s=vec2u(s.x>>3u,(s.y>>3u)|(s.x<<29u));
 if(below>4u||(below==4u&&(s.y&1u)==1u)){s=wideAdd(s,vec2u(0u,1u));}
 if((s.x>>21u)!=0u){
  s=vec2u(s.x>>1u,(s.y>>1u)|(s.x<<31u));
  e=e+1;
 }
 if(e>=2047){return vec2u((sign<<31u)|0x7ff00000u,0u);}
 let field=select(0u,u32(e),(s.x&0x100000u)!=0u);
 return vec2u((sign<<31u)|(field<<20u)|(s.x&0xfffffu),s.y);
}
fn dAdd(a:vec2u,b:vec2u)->vec2u{
 let ea=dExponent(a);
 let eb=dExponent(b);
 if(ea==0x7ffu||eb==0x7ffu){
  if(dIsNan(a)||dIsNan(b)){return dNan();}
  if(ea==eb&&((a.x^b.x)>>31u)!=0u){return dNan();}
  return select(b,a,ea==0x7ffu);
 }
 if(dIsZero(b)){
  if(dIsZero(a)){return vec2u(a.x&b.x&0x80000000u,0u);}
  return a;
 }
 if(dIsZero(a)){return b;}
 let magnitudeA=a.x&0x7fffffffu;
 let magnitudeB=b.x&0x7fffffffu;
 let swapped=magnitudeB>magnitudeA||(magnitudeB==magnitudeA&&b.y>a.y);
 let big=select(a,b,swapped);
 let small=select(b,a,swapped);
 let scale=dScale(big);
 let wide=wideShiftLeft(dSignificand(big),3u);
 let narrow=wideShiftRight(wideShiftLeft(dSignificand(small),3u),u32(scale-dScale(small)));
 if(((a.x^b.x)>>31u)==0u){
  let sum=wideAdd(wide,narrow);
  if((sum.x>>24u)!=0u){return dRound(big.x>>31u,scale+1,wideShiftRight(sum,1u));}
  return dRound(big.x>>31u,scale,sum);
 }
 let difference=wideSub(wide,narrow);
 if((difference.x|difference.y)==0u){return vec2u(0u,0u);}
 let shift=wideLeadingZeros(difference)-8u;
 return dRound(big.x>>31u,scale-i32(shift),wideShiftLeft(difference,shift));
}
fn dSub(a:vec2u,b:vec2u)->vec2u{return dAdd(a,vec2u(b.x^0x80000000u,b.y));}
fn dMul(a:vec2u,b:vec2u)->vec2u{
 let sign=(a.x^b.x)>>31u;
 if(dIsNan(a)||dIsNan(b)){return dNan();}
 let zero=dIsZero(a)||dIsZero(b);
 if(dExponent(a)==0x7ffu||dExponent(b)==0x7ffu){
  if(zero){return dNan();}
  return vec2u((sign<<31u)|0x7ff00000u,0u);
 }
 if(zero){return vec2u(sign<<31u,0u);}
 // Both significands brought to bit 52, a subnormal's scale lowered to match.
 let shiftA=wideLeadingZeros(dSignificand(a))-11u;
 let shiftB=wideLeadingZeros(dSignificand(b))-11u;
 let x=wideShiftLeft(dSignificand(a),shiftA);
 let y=wideShiftLeft(dSignificand(b),shiftB);
 let scale=dScale(a)-i32(shiftA)+dScale(b)-i32(shiftB)-1023;
 // The 106-bit product in four words: upper.x, upper.y, lower.y, low.y, the highest first.
 let low=wideProduct(x.y,y.y);
 let lower=wideAdd(vec2u(0u,low.x),wideAdd(wideProduct(x.x,y.y),wideProduct(x.y,y.x)));
 let upper=wideAdd(wideProduct(x.x,y.x),vec2u(0u,lower.x));
 // Its leading bit is 104 or 105: shifted right by 49 or 50, it stands at 55.
 let shift=select(17u,18u,(upper.x>>9u)!=0u);
 var m=vec2u((upper.y>>shift)|(upper.x<<(32u-shift)),(lower.y>>shift)|(upper.y<<(32u-shift)));
 if(low.y!=0u||(lower.y&lowBits(shift))!=0u){m.y=m.y|1u;}
 return dRound(sign,scale+i32(shift)-17,m);
}
/**
 * \`a / b\`, rounded once. Both significands brought to bit 52, the dividend doubled when below the
 * divisor so the first quotient bit is one; then 56 quotient bits by long division, the leading one
 * at 55 as \`dRound\` takes it, and a remainder left folded into the lowest bit (sticky). The quotient
 * of \`x·2^(sa−1075)\` by \`y·2^(sb−1075)\` is \`q·2^(sa−sb−55)\`, which is \`q·2^(scale−1078)\` for
 * \`scale = sa − sb + 1023\`. Every remainder stays below twice the divisor, under 2^54.
 */
fn dDiv(a:vec2u,b:vec2u)->vec2u{
 let sign=(a.x^b.x)>>31u;
 if(dIsNan(a)||dIsNan(b)){return dNan();}
 let infiniteA=dExponent(a)==0x7ffu;
 let infiniteB=dExponent(b)==0x7ffu;
 if((infiniteA&&infiniteB)||(dIsZero(a)&&dIsZero(b))){return dNan();}
 if(infiniteA||dIsZero(b)){return vec2u((sign<<31u)|0x7ff00000u,0u);}
 if(infiniteB||dIsZero(a)){return vec2u(sign<<31u,0u);}
 let shiftA=wideLeadingZeros(dSignificand(a))-11u;
 let shiftB=wideLeadingZeros(dSignificand(b))-11u;
 var x=wideShiftLeft(dSignificand(a),shiftA);
 let y=wideShiftLeft(dSignificand(b),shiftB);
 var scale=dScale(a)-i32(shiftA)-dScale(b)+i32(shiftB)+1023;
 if(x.x<y.x||(x.x==y.x&&x.y<y.y)){
  x=wideShiftLeft(x,1u);
  scale=scale-1;
 }
 var q=vec2u(0u,0u);
 for(var i=0u;i<56u;i++){
  q=wideShiftLeft(q,1u);
  if(x.x>y.x||(x.x==y.x&&x.y>=y.y)){
   x=wideSub(x,y);
   q.y=q.y|1u;
  }
  x=wideShiftLeft(x,1u);
 }
 if((x.x|x.y)!=0u){q.y=q.y|1u;}
 return dRound(sign,scale,q);
}
`,
)
