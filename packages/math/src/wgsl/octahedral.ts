import { wgslConst, wgslFn } from './decl.ts'
import { PI } from './constants.ts'
import { wgslF32 } from './number.ts'
import { byteOf } from './integer.ts'
import { OCT_BYTE_STEP as BYTE_STEP } from '../constants.ts'

/**
 * The octahedral map: a unit vector projected on `|x|+|y|+|z| = 1`, its lower half folded over the
 * upper one (`octFold`), lands in the square [-1,1]². One map, `z` its pole (`octEncode`,
 * `octDecode`, the Rust core's `project`, `unproject`). The map of a square of texels of the same solid angle
 * each, whose probes' radiance is sampled and projected on harmonics, is the equal-area one (`equalAreaDecode`,
 * `equalAreaEncode`), its border wrapped as an octahedron's (`octWrapBorder`).
 */

/** The fold of the lower half: each axis `1 − |other|` on its own side, `+` at zero. One rounding,
 *  the same both ways (`octEncode` and `octUnfold` call it). */
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

/** The point of the octahedron a square point lands from, not yet normalized (`octDecode`). */
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

/** The unit normal two cells of the octahedron of `bits` bits an axis stand for: each cell times the
 *  grid's step less one, `z` one less their magnitudes, the lower half unfolded by what `z` lacks of
 *  zero (`e ± lack`, not `octUnfold`'s fold), the vector made unit. The shader twin of the page
 *  codec's `normal_decode` (`page-codec-wasm/src/bits/oct.rs`). */
export const octCellsDecode = wgslFn(
  'octCellsDecode',
  [],
  `fn octCellsDecode(cells:vec2u,bits:u32)->vec3f{
 let e=vec2f(cells)*(2.0/f32((1u<<bits)-1u))-1.0;
 let z=1.0-abs(e.x)-abs(e.y);
 let lack=select(0.0,min(-z,1.0),z<0.0);
 return normalize(vec3f(select(e+lack,e-lack,e>=vec2f(0.0)),z));
}`,
)

/** The two cells of the octahedron of `bits` bits an axis that a unit normal lies nearest: the inverse of `octCellsDecode` at the
 *  cells' centres (`octEncode`'s square point, scaled to the grid's step less one and rounded). */
export const octCellsEncode = wgslFn(
  'octCellsEncode',
  [octEncode],
  'fn octCellsEncode(n:vec3f,bits:u32)->vec2u{return vec2u(round((octEncode(n)*0.5+0.5)*f32((1u<<bits)-1u)));}',
)

/** The step of an octahedral byte, 2/255 in `f32`: a byte `q` back to `[-1, 1]` as
 *  `f32(q)·OCT_BYTE_STEP − 1` (`OCT_BYTE_STEP` of `../constants.ts`, `OCT_SCALE` of the Rust codec). */
const OCT_BYTE_STEP = wgslConst(
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

/** The direction of the point `uv` of the unit square, equal-area on the sphere: every texel of a regular grid of
 *  the square stands for the same solid angle (Shirley and Chiu's concentric map on the octahedron's radius). */
export const equalAreaDecode = wgslFn(
  'equalAreaDecode',
  [PI],
  `fn equalAreaDecode(uv:vec2f)->vec3f{
 let e=2.0*uv-vec2f(1.0);
 let d=1.0-(abs(e.x)+abs(e.y));
 let r=1.0-abs(d);
 let phi=select(0.0,(PI/4.0)*((abs(e.y)-abs(e.x))/max(r,1e-20)+1.0),r!=0.0);
 let f=r*sqrt(max(2.0-r*r,0.0));
 let sx=select(-1.0,1.0,e.x>=0.0);let sy=select(-1.0,1.0,e.y>=0.0);let sz=select(-1.0,1.0,d>=0.0);
 return vec3f(f*sx*abs(cos(phi)),f*sy*abs(sin(phi)),sz*(1.0-r*r));
}`,
)

/** The point of the unit square a unit direction maps to: the inverse of `equalAreaDecode`. */
export const equalAreaEncode = wgslFn(
  'equalAreaEncode',
  [PI],
  `fn equalAreaEncode(direction:vec3f)->vec2f{
 let d=normalize(direction);
 let a=abs(d);
 let r=sqrt(max(1.0-a.z,0.0));
 let x=min(a.x,a.y)/(max(a.x,a.y)+5.42101086243e-20);
 let angle=atan(x)*(2.0/PI);
 let phi=select(angle,1.0-angle,a.x<a.y);
 var uv=vec2f(r-phi*r,phi*r);
 uv=select(uv,vec2f(1.0)-uv.yx,d.z<0.0);
 uv=vec2f(select(uv.x,-uv.x,d.x<0.0),select(uv.y,-uv.y,d.y<0.0));
 return uv*0.5+vec2f(0.5);
}`,
)

/** The texel an octahedral map of `resolution` texels a side and a border of `border` texels wraps a texel
 *  to, the border removed: a border texel is its mirror inside the map. */
export const octWrapBorder = wgslFn(
  'octWrapBorder',
  [],
  `fn octWrapBorder(texel:vec2u,resolution:u32,border:u32)->vec2u{
 var t=texel;
 if(t.x<border){t.x=border-1u+border-t.x;t.y=resolution-1u-t.y;}
 if(t.x>=resolution-border){t.x=(resolution-border)-(t.x-(resolution-border-1u));t.y=resolution-1u-t.y;}
 if(t.y<border){t.y=border-1u+border-t.y;t.x=resolution-1u-t.x;}
 if(t.y>=resolution-border){t.y=(resolution-border)-(t.y-(resolution-border-1u));t.x=resolution-1u-t.x;}
 return t-vec2u(border);
}`,
)
