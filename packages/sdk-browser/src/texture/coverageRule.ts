import { wgslBlock } from '../../../math/src/wgsl/decl.ts'

/**
 * The arithmetic of the coverage-preserving alpha rule (`texture_preview/coverage.rs`, #44), in
 * WGSL, as the card's chains run it. The scale: `median`, a level's alpha byte as the compiler
 * rounds it, `scaled`, step 4, and `reducedAlpha`, what a reduced texel stores — the median alone
 * without a cutoff, byte for byte as before. The pick, step 3 over the level's histogram:
 * `pickKey`, the key of byte `t` given the level's texels at and past it (`above`), whose least
 * is the pick (`COVERAGE_CHOOSE_WGSL`); its products pass 32 bits, so `wide` holds one as (high,
 * low) words, `apart` their distance, and `below` orders (error, distance to C, t) as the
 * compiler's `min` does. The cut (#43): `filtered`, the byte of a texel's bilinear sample `s`
 * of the square of corner alphas `a`, and `cutBin`, the highest `t` whose scale lifts that sample
 * to `C` — the bin it is counted in, coverage measured on the filtered cut, not on the texels —,
 * searched between the square's lowest and highest corners: a corner reaches `C` exactly when `t`
 * is at most its byte.
 */

/** The two middle values of four, `v.x` to `v.w`: the lower of the pair maxima and the higher of
 *  the pair minima, whose sum is the four's sum less their maximum and minimum: the median of the
 *  byte chain and the alpha of a blended reader's chain are one text. */
const middles = (v: string) =>
  [
    `min(max(${v}.x,${v}.y),max(${v}.z,${v}.w))`,
    `max(min(${v}.x,${v}.y),min(${v}.z,${v}.w))`,
  ] as const
const [U_BYTE, V_BYTE] = middles('b')
const [U_ALPHA, V_ALPHA] = middles('a')

export const COVERAGE_SCALE_WGSL = wgslBlock(
  'COVERAGE_SCALE_WGSL',
  [],
  `
fn toByte(x:f32)->u32{return u32(round(x*255.0));}
fn median(a:vec4f)->u32{
 let b=vec4u(toByte(a.x),toByte(a.y),toByte(a.z),toByte(a.w));
 return (${U_BYTE}+${V_BYTE}+1u)>>1u;
}
fn scaled(a:u32,c:u32,t:u32)->u32{return min(255u,u32((2u*a*(2u*c-1u)+2u*t-1u)/(4u*t-2u)));}
fn reducedAlpha(a:vec4f,c:u32,t:u32)->f32{
 if(c==0u){let u=${U_ALPHA};let v=${V_ALPHA};return (u+v)*0.5;}
 return f32(scaled(median(a),c,t))/255.0;
}`,
)
export const COVERAGE_PICK_WGSL = wgslBlock(
  'COVERAGE_PICK_WGSL',
  [],
  `
fn wide(a:u32,b:u32)->vec2u{
 let al=a&0xffffu;let ah=a>>16u;let bl=b&0xffffu;let bh=b>>16u;
 let mid=((al*bl)>>16u)+((al*bh)&0xffffu)+((ah*bl)&0xffffu);
 return vec2u(ah*bh+((al*bh)>>16u)+((ah*bl)>>16u)+(mid>>16u),(mid<<16u)|((al*bl)&0xffffu));
}
fn below(a:vec4u,b:vec4u)->bool{return a.x<b.x||(a.x==b.x&&(a.y<b.y||(a.y==b.y&&(a.z<b.z||(a.z==b.z&&a.w<b.w)))));}
fn apart(a:vec2u,b:vec2u)->vec2u{
 let swap=below(vec4u(a,0u,0u),vec4u(b,0u,0u));let hi=select(a,b,swap);let lo=select(b,a,swap);
 return vec2u(hi.x-lo.x-u32(hi.y<lo.y),hi.y-lo.y);
}
fn pickKey(c:u32,t:u32,above:u32,texels:vec2u,goal:vec2u)->vec4u{
 let error=apart(wide(above,texels.x),goal);
 return vec4u(error.x,error.y,max(t,c)-min(t,c),t);
}`,
)

export const COVERAGE_CUT_WGSL = wgslBlock(
  'COVERAGE_CUT_WGSL',
  [COVERAGE_SCALE_WGSL],
  `
fn filtered(a:vec4u,s:u32)->u32{
 let x=3u-2u*(s&1u);let y=3u-2u*(s>>1u);
 return (y*(x*a.x+(4u-x)*a.y)+(4u-y)*(x*a.z+(4u-x)*a.w)+8u)>>4u;
}
fn cutBin(a:vec4u,s:u32,c:u32)->u32{
 var low=min(min(a.x,a.y),min(a.z,a.w));var high=max(max(a.x,a.y),max(a.z,a.w))+1u;
 while(high-low>1u){
  let t=(low+high)>>1u;
  if(filtered(vec4u(scaled(a.x,c,t),scaled(a.y,c,t),scaled(a.z,c,t),scaled(a.w,c,t)),s)>=c){low=t;}else{high=t;}
 }
 return low;
}`,
)
