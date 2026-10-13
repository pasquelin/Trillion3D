import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { wideProduct } from '../../../math/src/wgsl/integer.ts'
import { SCALED_WGSL } from './coverageMathWgsl.ts'

/**
 * The coverage-preserving alpha rule (`texture_preview/coverage.rs`, #44) in WGSL, as the card's
 * chains run it, around its integer arithmetic (`coverageMath.ts`, printed into
 * `coverageMathWgsl.ts`: `scaled`, step 4, and the cut's `filtered` and `cutBin`). The scale:
 * `median`, a level's alpha byte as the compiler rounds it, and `reducedAlpha`, what a reduced
 * texel stores — the median alone without a cutoff, byte for byte as before. The pick, step 3 over
 * the level's histogram: `pickKey`, the key of byte `t` given the level's texels at and past it
 * (`above`), whose least is the pick (`COVERAGE_CHOOSE_WGSL`); its products pass 32 bits, so
 * `wideProduct` holds one as (high, low) words, `apart` their distance, and `below` orders
 * (error, distance to C, t) as the compiler's `min` does.
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
  [SCALED_WGSL],
  `
fn toByte(x:f32)->u32{return u32(round(x*255.0));}
fn median(a:vec4f)->u32{
 let b=vec4u(toByte(a.x),toByte(a.y),toByte(a.z),toByte(a.w));
 return (${U_BYTE}+${V_BYTE}+1u)>>1u;
}
fn reducedAlpha(a:vec4f,c:u32,t:u32)->f32{
 if(c==0u){let u=${U_ALPHA};let v=${V_ALPHA};return (u+v)*0.5;}
 return f32(scaled(median(a),c,t))/255.0;
}`,
)
export const COVERAGE_PICK_WGSL = wgslBlock(
  'COVERAGE_PICK_WGSL',
  [wideProduct],
  `
fn below(a:vec4u,b:vec4u)->bool{return a.x<b.x||(a.x==b.x&&(a.y<b.y||(a.y==b.y&&(a.z<b.z||(a.z==b.z&&a.w<b.w)))));}
fn apart(a:vec2u,b:vec2u)->vec2u{
 let swap=below(vec4u(a,0u,0u),vec4u(b,0u,0u));let hi=select(a,b,swap);let lo=select(b,a,swap);
 return vec2u(hi.x-lo.x-u32(hi.y<lo.y),hi.y-lo.y);
}
fn pickKey(c:u32,t:u32,above:u32,texels:vec2u,goal:vec2u)->vec4u{
 let error=apart(wideProduct(above,texels.x),goal);
 return vec4u(error.x,error.y,max(t,c)-min(t,c),t);
}`,
)
