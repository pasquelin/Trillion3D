/**
 * Points and boxes carried by a matrix in doubles on the GPU (`double.ts`'s representation, two
 * words), as the CPU carries them (`../geometry/box.ts`): each coordinate the row's products summed
 * left to right, then the translation — `transformPointRow` —, and a box the union of its eight
 * corners with `Math.min` and `Math.max`, a NaN kept (`doubleOrder.ts`) — `boxTransform`.
 */
import { wgslFn } from './decl.ts'
import { dAdd, dDot3 } from './double.ts'
import { dMathMax, dMathMin } from './doubleOrder.ts'
import { D_INFINITY, D_NEG_INFINITY } from './doubleConstants.ts'

/** One row of an affine product, its three factors `a`, `b`, `c` and its translation `t`:
 *  `a·x + b·y + c·z + t`, summed left to right. */
export const affineRow = wgslFn(
  'affineRow',
  [dAdd, dDot3],
  `fn affineRow(a:vec2u,b:vec2u,c:vec2u,t:vec2u,x:vec2u,y:vec2u,z:vec2u)->vec2u{
 return dAdd(dDot3(a,x,b,y,c,z),t);
}`,
)

/** Row `i` of `w · (x, y, z, 1)`, `w` sixteen doubles column-major:
 *  `w[i]·x + w[4+i]·y + w[8+i]·z + w[12+i]` (`affineRow`). */
export const affineAxis = wgslFn(
  'affineAxis',
  [affineRow],
  `fn affineAxis(w:array<vec2u,16>,i:u32,x:vec2u,y:vec2u,z:vec2u)->vec2u{
 return affineRow(w[i],w[4u+i],w[8u+i],w[12u+i],x,y,z);
}`,
)

/** `boxTransform` of a box (six doubles, its minima then its maxima) by an affine `m`: the union
 *  of its eight carried corners, a corner reaching a NaN leaving a NaN bound. No divide is pulled
 *  in: the worlds a node tree composes are every one affine (`../../../sdk-browser/src/placement/`).
 *  THE BOX IS NON-EMPTY AND ITS BOUNDS FINITE, its caller's guard (a carried root's box,
 *  `carriedBox`): `boxTransform` returns an empty box as it is and takes an infinite bound down its
 *  projective path (`unitW`), neither of which this text tests. */
export const dBoxAffine = wgslFn(
  'dBoxAffine',
  [affineRow, dMathMax, dMathMin, D_INFINITY, D_NEG_INFINITY],
  `fn dBoxAffine(box:array<vec2u,6>,m:array<vec2u,16>)->array<vec2u,6>{
 var out:array<vec2u,6>;
 for(var k=0u;k<3u;k++){
  out[k]=D_INFINITY;
  out[k+3u]=D_NEG_INFINITY;
 }
 for(var i=0u;i<8u;i++){
  let lx=select(box[0],box[3],(i&1u)!=0u);
  let ly=select(box[1],box[4],(i&2u)!=0u);
  let lz=select(box[2],box[5],(i&4u)!=0u);
  var x=affineRow(m[0],m[4],m[8],m[12],lx,ly,lz);
  var y=affineRow(m[1],m[5],m[9],m[13],lx,ly,lz);
  var z=affineRow(m[2],m[6],m[10],m[14],lx,ly,lz);
  out[0]=dMathMin(out[0],x);
  out[1]=dMathMin(out[1],y);
  out[2]=dMathMin(out[2],z);
  out[3]=dMathMax(out[3],x);
  out[4]=dMathMax(out[4],y);
  out[5]=dMathMax(out[5],z);
 }
 return out;
}`,
)
