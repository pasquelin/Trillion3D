import { ERR_K, INPUT_K, wgslFloat } from '../partition/margins.ts'
const K = wgslFloat(ERR_K),
  IN = wgslFloat(INPUT_K)

/** Shared conservative dot and quotient arithmetic used by camera and shadow occlusion. */
export const PROJECTION_SLACK_WGSL = `
/**
 * A four-term dot product on an anchored point, and enough to bound its error: the value, the
 * sum of absolute values of the terms, and the share of input rounding —
 * \`Σ|m_i| · 3u|d_i|\`, where \`d\` is the corner's offset from the anchor.
 */
fn dot4(a0:f32,a1:f32,a2:f32,a3:f32,d:vec3f,mag:vec3f)->vec3f{
 let p=vec3f(a0*d.x,a1*d.y,a2*d.z);
 return vec3f(
  p.x+p.y+p.z+a3,
  abs(p.x)+abs(p.y)+abs(p.z)+abs(a3),
  abs(a0)*mag.x+abs(a1)*mag.y+abs(a2)*mag.z);
}
/** Upper slack of a dot product: compute rounding and input rounding together. */
fn slackOf(term:vec3f)->f32{return ${K}*term.y+${IN}*term.z;}
/** Upper slack of a quotient whose numerator and denominator each carry their own. */
fn quotientSlack(value:f32,num:vec3f,den:vec3f)->f32{
 return (slackOf(num)+abs(value)*slackOf(den))/den.x+${K}*abs(value);
}
`
