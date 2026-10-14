/**
 * Points and boxes carried by a matrix in doubles on the GPU (`double.ts`'s representation, two
 * words), as the CPU carries them (`../geometry/box.ts`): each coordinate the row's products summed
 * left to right, then the translation — `transformPointRow` —, and a box the union of its eight
 * corners with `Math.min` and `Math.max`, a NaN kept (`doubleOrder.ts`) — `boxTransform`.
 */
import { wgslFn } from './decl.ts'
import { dAdd, dDiv, dMul } from './double.ts'
import { dIsZero } from './doubleWords.ts'
import { dMathMax, dMathMin } from './doubleOrder.ts'
import { wgslDouble } from './number.ts'

/** Row `i` of `w · (x, y, z, 1)`, `w` sixteen doubles column-major:
 *  `w[i]·x + w[4+i]·y + w[8+i]·z + w[12+i]`, summed left to right. */
export const affineAxis = wgslFn(
  'affineAxis',
  [dAdd, dMul],
  `fn affineAxis(w:array<vec2u,16>,i:u32,x:vec2u,y:vec2u,z:vec2u)->vec2u{
 return dAdd(dAdd(dAdd(dMul(w[i],x),dMul(w[4u+i],y)),dMul(w[8u+i],z)),w[12u+i]);
}`,
)

/** The text of `boxTransform` of a box (six doubles, its minima then its maxima) by `m`: the union
 *  of its eight carried corners, each divided by its `w` unless the last row is `0, 0, 0, 1` — that
 *  divide written only when `projective` —. A corner reaching a NaN leaves a NaN bound. One body,
 *  two entry points (`dBoxTransform`, `dBoxAffine`): an affine world takes the same words in both. */
function boxTransformText(name: string, projective: boolean) {
  // Whether `m` is affine, and each corner divided by its `w` when it is not.
  const affine = `
 let one=${wgslDouble(1)};
 let affine=dIsZero(m[3])&&dIsZero(m[7])&&dIsZero(m[11])&&m[15].x==one.x&&m[15].y==one.y;`
  const divide = `
  if(!affine){
   let mw=dDiv(one,affineAxis(m,3u,lx,ly,lz));
   x=dMul(x,mw);
   y=dMul(y,mw);
   z=dMul(z,mw);
  }`
  return `fn ${name}(box:array<vec2u,6>,m:array<vec2u,16>)->array<vec2u,6>{${projective ? affine : ''}
 var out:array<vec2u,6>;
 for(var k=0u;k<3u;k++){
  out[k]=${wgslDouble(Infinity)};
  out[k+3u]=${wgslDouble(-Infinity)};
 }
 for(var i=0u;i<8u;i++){
  let lx=select(box[0],box[3],(i&1u)!=0u);
  let ly=select(box[1],box[4],(i&2u)!=0u);
  let lz=select(box[2],box[5],(i&4u)!=0u);
  var x=affineAxis(m,0u,lx,ly,lz);
  var y=affineAxis(m,1u,lx,ly,lz);
  var z=affineAxis(m,2u,lx,ly,lz);${projective ? divide : ''}
  out[0]=dMathMin(out[0],x);
  out[1]=dMathMin(out[1],y);
  out[2]=dMathMin(out[2],z);
  out[3]=dMathMax(out[3],x);
  out[4]=dMathMax(out[4],y);
  out[5]=dMathMax(out[5],z);
 }
 return out;
}`
}

/** `boxTransform` of a box by `m`, any matrix (`boxTransformText`): the water's enclosure. */
export const dBoxTransform = wgslFn(
  'dBoxTransform',
  [affineAxis, dDiv, dMul, dIsZero, dMathMax, dMathMin],
  boxTransformText('dBoxTransform', true),
)

/** `boxTransform` of a box by an affine `m` (`boxTransformText`), no divide pulled in: the worlds
 *  a node tree composes, every one affine (`../../../sdk-browser/src/placement/`). */
export const dBoxAffine = wgslFn(
  'dBoxAffine',
  [affineAxis, dMathMax, dMathMin],
  boxTransformText('dBoxAffine', false),
)
