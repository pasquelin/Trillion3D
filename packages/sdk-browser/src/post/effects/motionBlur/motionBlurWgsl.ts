import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { PI, TWO_PI } from '../../../../../math/src/wgsl/constants.ts'
import { wgslF32 } from '../../../../../math/src/wgsl/number.ts'
import { DEG2RAD } from '../../../../../math/src/constants.ts'
import { packSmallFloat, unpackSmallFloat } from '../../../gpu/core/smallFloatWgsl.ts'
import { MOTION_BLUR_PARAMS } from './motionBlurLayout.ts'

/**
 * What the motion blur's shaders share: the uniform they read, and the ranges of motion they
 * keep for each tile. A range holds the largest motion of a tile and its smallest, each as a
 * length and an angle in pixels (the polar form, which orders them by length), packed
 * `(largest length, largest angle, smallest length, smallest angle)`; in the tile images the same
 * two as vectors, `(smallest.xy, largest.xy)`.
 */

/** The uniform every pass of the blur reads, `mb` (`MOTION_BLUR_PARAMS`). */
export const MOTION_BLUR_PARAMS_WGSL = wgslBlock(
  'MOTION_BLUR_PARAMS_WGSL',
  [],
  MOTION_BLUR_PARAMS.wgsl,
)

/**
 * The polar form of the motion and the ranges built on it:
 * - `toPolar`, `toCartesian`: a vector as its length and its angle, and back; a vector of no
 *   length has angle 0;
 * - `reduceRange`: the range of two ranges, the longer largest motion and the shorter smallest —
 *   on equal lengths the largest of the second and the smallest of the first;
 * - `toPolarRange`, `toCartesianRange`: a tile image's texel as a range, and back.
 */
export const POLAR_WGSL = wgslBlock(
  'POLAR_WGSL',
  [],
  `
fn toPolar(v:vec2f)->vec2f{
 let l=length(v);
 return vec2f(l,select(0.0,atan2(v.y,v.x),l>0.0));
}
fn toCartesian(p:vec2f)->vec2f{return vec2f(cos(p.y),sin(p.y))*p.x;}
fn reduceRange(a:vec4f,b:vec4f)->vec4f{
 return vec4f(select(b.xy,a.xy,a.x>b.x),select(a.zw,b.zw,a.z>b.z));
}
fn toPolarRange(r:vec4f)->vec4f{return vec4f(toPolar(r.zw),toPolar(r.xy));}
fn toCartesianRange(r:vec4f)->vec4f{return vec4f(toCartesian(r.zw),toCartesian(r.xy));}`,
)

/** The angle, in degrees, under which two largest motions are one: a second motion is the largest
 *  that lies further from the first than this. */
const SPLIT_DEGREES = 5

/**
 * The second largest motion a range keeps with two directions, beside the range as above:
 * - `polarGap`: the angle between two angles, round the circle, at most a half turn;
 * - `reduceSecond`: the second of two ranges, each with its own: where their largest motions
 *   lie within `SPLIT_DEGREES` of each other it is the longer of the two seconds; else the largest
 *   of the shorter of the two largest motions and both seconds — so a second motion stays in a
 *   different direction than the first.
 */
export const POLAR_TWO_WGSL = wgslBlock(
  'POLAR_TWO_WGSL',
  [PI, TWO_PI],
  `
const SPLIT_ANGLE:f32=${wgslF32(SPLIT_DEGREES * DEG2RAD)};
fn polarGap(a:f32,b:f32)->f32{
 let gap=abs(a-b);
 return select(gap,TWO_PI-gap,gap>PI);
}
fn reduceSecond(a:vec4f,aSecond:vec2f,b:vec4f,bSecond:vec2f)->vec2f{
 if(polarGap(a.y,b.y)<SPLIT_ANGLE){return select(bSecond,aSecond,aSecond.x>bSecond.x);}
 let shorter=select(a.xy,b.xy,a.x>b.x);
 let kept=select(aSecond,shorter,shorter.x>aSecond.x);
 return select(bSecond,kept,kept.x>bSecond.x);
}`,
)

/**
 * The frame a tile's streak — its range's largest motion in tiles — is laid out in
 * (`streakFrame`): its length `span`, its direction `axis` and the `extent` a tile has along it,
 * the sum of the axis's two components, so a streak one tile wide covers the tiles it crosses
 * (`tileStreakCovers`, the gather) or is drawn as a quad of them (`scatterVertex`, the drawing).
 */
export const STREAK_FRAME_WGSL = wgslBlock(
  'STREAK_FRAME_WGSL',
  [],
  `
struct StreakFrame{span:f32,axis:vec2f,extent:f32}
fn streakFrame(streak:vec2f)->StreakFrame{
 let squared=dot(streak,streak);
 let inverse=inverseSqrt(squared+1e-8);
 let axis=streak*inverse;
 return StreakFrame(squared*inverse,axis,abs(axis.x)+abs(axis.y));
}`,
)

/**
 * The flattened motion in one word, three unsigned small floats as a 3-channel 11-11-10 float
 * holds them: a length and an angle of 5 bits of exponent and 6 of mantissa, a depth of 5 and 5.
 * - `packSmallFloat`, `unpackSmallFloat` (`../../../gpu/core/smallFloatWgsl.ts`, the engine's one pack of the
 *   format): a number as the field of `mantissa` bits, round to nearest, held to the format's range, and back;
 * - `packFlat`, `unpackFlat`: a texel's length, angle and depth in the word's three fields, the
 *   first in its low bits; `unpackFlat` returns them as `(length, angle, depth)`.
 */
export const FLAT_PACK_WGSL = wgslBlock(
  'FLAT_PACK_WGSL',
  [packSmallFloat, unpackSmallFloat],
  `
fn packFlat(reach:f32,angle:f32,depth:f32)->u32{
 return packSmallFloat(reach,6u)|(packSmallFloat(angle,6u)<<11u)|(packSmallFloat(depth,5u)<<22u);
}
fn unpackFlat(word:u32)->vec3f{
 return vec3f(unpackSmallFloat(word&0x7ffu,6u),unpackSmallFloat((word>>11u)&0x7ffu,6u),unpackSmallFloat(word>>22u,5u));
}`,
)
