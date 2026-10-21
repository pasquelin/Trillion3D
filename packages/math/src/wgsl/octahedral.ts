import { wgslConst, wgslFn } from './decl.ts'
import { wgslF32 } from './number.ts'
import { byteOf } from './integer.ts'
import { OCT_BYTE_STEP as BYTE_STEP } from '../constants.ts'

/**
 * The octahedral map: a unit vector projected on `|x|+|y|+|z| = 1`, its lower half folded over the
 * upper one (`octFold`), lands in the square [-1,1]². One map, `z` its pole (`octEncode`,
 * `octDecode`, the Rust core's `project`, `unproject`); the impostor's reads it with `y` and `z`
 * swapped, or takes the upper hemi-octahedron (`octEncodeHemi`, `octDecodeHemi`).
 */

/** The fold of the lower half: each axis `1 − |other|` on its own side, `+` at zero. One rounding,
 *  the same both ways (`octEncode`, `octDecode` and the impostor's pair call it). */
const octFold = wgslFn(
  'octFold',
  [],
  'fn octFold(e:vec2f)->vec2f{return (1.0-abs(e.yx))*select(vec2f(-1.0),vec2f(1.0),e>=vec2f(0.0));}',
)

export const octEncode = wgslFn(
  'octEncode',
  [octFold],
  `fn octEncode(n:vec3f)->vec2f{
 let sum=abs(n.x)+abs(n.y)+abs(n.z);
 let p=n.xy/select(sum,1.0,sum<=0.0);
 return select(octFold(p),p,n.z>=0.0);
}`,
)

/** The point of the octahedron a square point lands from, not yet normalized: the impostor's map
 *  swizzles it first, so its length sums the components in its own axes' order. */
const octUnfold = wgslFn(
  'octUnfold',
  [octFold],
  `fn octUnfold(e:vec2f)->vec3f{
 let z=1.0-abs(e.x)-abs(e.y);
 return vec3f(select(e,octFold(e),z<0.0),z);
}`,
)

export const octDecode = wgslFn(
  'octDecode',
  [octUnfold],
  'fn octDecode(e:vec2f)->vec3f{return normalize(octUnfold(e));}',
)

/**
 * The impostor's map, `y` its pole: the signed map (`octEncode`, `octDecode`) with `y` and `z`
 * swapped, or the upper hemi-octahedron, which first flattens a direction below the horizon onto
 * it. A direction with no part on the map's octahedron (zero, or straight down on the
 * hemi-octahedron) reads the zenith frame `(0, 0)`, as the compiler's `octahedral_encode` defines
 * it: a zero sum is replaced by 1, never divided by — in `octEncode` too. One return each.
 */
export const octEncodeHemi = wgslFn(
  'octEncodeHemi',
  [octEncode],
  `fn octEncodeHemi(d:vec3f,hemi:f32)->vec2f{
 let upper=hemi==1.0;
 let v=select(d,vec3f(d.x,max(d.y,0.0),d.z),upper);
 let sum=abs(v.x)+abs(v.y)+abs(v.z);
 let o=v/select(sum,1.0,sum<=0.0);
 return select(octEncode(v.xzy),vec2f(o.x+o.z,o.z-o.x),upper);
}`,
)

export const octDecodeHemi = wgslFn(
  'octDecodeHemi',
  [octUnfold],
  `fn octDecodeHemi(f:vec2f,hemi:f32)->vec3f{
 let hx=f.x-f.y;
 let hz=f.x+f.y-1.0;
 let hemiDir=normalize(vec3f(hx,1.0-abs(hx)-abs(hz),hz));
 let full=normalize(octUnfold(f*2.0-1.0).xzy);
 return select(full,hemiDir,hemi==1.0);
}`,
)

/** The step of an octahedral byte, 2/255 in `f32`: a byte `q` back to `[-1, 1]` as
 *  `f32(q)·OCT_BYTE_STEP − 1` (`OCT_BYTE_STEP` of `../constants.ts`, `OCT_SCALE` of the Rust codec). */
export const OCT_BYTE_STEP = wgslConst(
  'OCT_BYTE_STEP',
  [],
  `const OCT_BYTE_STEP:f32=${wgslF32(BYTE_STEP)};`,
)

/** The unit vector of the two octahedral bytes at byte `k` of `word` (`OCT_BYTE_STEP`): a voxel's
 *  contour normal. */
export const octBytesDecode = wgslFn(
  'octBytesDecode',
  [octDecode, byteOf, OCT_BYTE_STEP],
  'fn octBytesDecode(word:u32,k:u32)->vec3f{return octDecode(vec2f(f32(byteOf(word,k)),f32(byteOf(word,k+1u)))*OCT_BYTE_STEP-1.0);}',
)
