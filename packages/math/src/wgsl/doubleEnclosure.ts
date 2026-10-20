/**
 * THE ENCLOSURE OF A BINARY32 TRANSFORM, IN EMULATED DOUBLES (`double.ts`): the CPU's `widenBox`,
 * `boxTransform` (`dBoxTransform`) and `encloseTransform` (`../geometry/boxEnclosure.ts`,
 * `../geometry/box.ts`), operation for operation — the same products, the same sums left to right,
 * `Math.min` and `Math.max` with their NaN (`dMathMin`) —, so each bound is the CPU's to the bit. A
 * box is six doubles, its minima then its maxima.
 */
import { wgslConst, wgslFn, wgslStruct } from './decl.ts'
import { dAbs, dAdd, dDiv, dMul, dSub } from './double.ts'
import { dNan } from './doubleWords.ts'
import { dBelow, dMathMax, dMathMin } from './doubleOrder.ts'
import { dIsFinite } from './doubleRound.ts'
import { dBoxTransform } from './doubleAffine.ts'
import { D_ZERO } from './doubleConstants.ts'
import { wgslDouble } from './number.ts'
import { FLOAT32_MAX } from '../constants.ts'
import { ROUND } from '../geometry/boxEnclosure.ts'
import { FLUSH, ROUNDING_GAMMA } from '../float/guards.ts'

/** The enclosure's bounds of error, the CPU's constants bit for bit: WGSL division's (`ROUND`),
 *  products' and sums' (`ROUNDING_GAMMA`), a flushed subnormal's (`FLUSH`), and the finite range. */
export const D_ROUND = wgslConst('D_ROUND', [], `const D_ROUND=${wgslDouble(ROUND)};`)
const D_GAMMA = wgslConst('D_GAMMA', [], `const D_GAMMA=${wgslDouble(ROUNDING_GAMMA)};`)
const D_FLUSH = wgslConst('D_FLUSH', [], `const D_FLUSH=${wgslDouble(FLUSH)};`)
const D_FLOAT32_MAX = wgslConst(
  'D_FLOAT32_MAX',
  [],
  `const D_FLOAT32_MAX=${wgslDouble(FLOAT32_MAX)};`,
)

/** The larger magnitude of a box's two bounds on one axis, `lo` and `hi`. */
const dAxisReach = wgslFn(
  'dAxisReach',
  [dAbs, dMathMax],
  `fn dAxisReach(lo:vec2u,hi:vec2u)->vec2u{return dMathMax(dAbs(lo),dAbs(hi));}`,
)

/** `widenBox(box, distance)`: each axis grown by `distance` and its binary32 rounding guard. */
export const dWidenBox = wgslFn(
  'dWidenBox',
  [dAdd, dMul, dSub, dAxisReach, D_GAMMA, D_FLUSH],
  `fn dWidenBox(box:array<vec2u,6>,distance:vec2u)->array<vec2u,6>{
 var out=box;
 for(var axis=0u;axis<3u;axis++){
  let error=dAdd(dMul(dAxisReach(box[axis],box[axis+3u]),D_GAMMA),D_FLUSH);
  let grow=dAdd(distance,error);
  out[axis]=dSub(box[axis],grow);
  out[axis+3u]=dAdd(box[axis+3u],grow);
 }
 return out;
}`,
)

/** How far the pose `m` stretches a length, bounded: the larger of its linear part's column and row
 *  sums of magnitudes, `max(‖M‖₁, ‖M‖∞)`, above its largest singular value; 1 for a rigid pose
 *  along the axes. A product's cofactors rounded in single precision may exceed the singular value
 *  but never this bound. The CPU’s `stretchBound` (`waterRect.fixture.ts`), sum for sum. */
export const dStretchBound = wgslFn(
  'dStretchBound',
  [dAdd, dAbs, dMathMax, D_ZERO],
  `fn dStretchBound(m:array<vec2u,16>)->vec2u{
 var stretch=D_ZERO;
 for(var k=0u;k<3u;k++){
  let column=dAdd(dAdd(dAbs(m[k*4u]),dAbs(m[k*4u+1u])),dAbs(m[k*4u+2u]));
  let row=dAdd(dAdd(dAbs(m[k]),dAbs(m[4u+k])),dAbs(m[8u+k]));
  stretch=dMathMax(dMathMax(stretch,column),row);
 }
 return stretch;
}`,
)

/** An enclosure (`dEncloseTransform`): the box, and the error it added to each nominal coordinate,
 *  as the CPU leaves it in its scratch. */
const DoubleEnclosure = wgslStruct(
  'DoubleEnclosure',
  [],
  'struct DoubleEnclosure{box:array<vec2u,6>,error:array<vec2u,3>,}',
)

/** `encloseTransform(box, m)`: the transformed box widened by the absolute error of its binary32
 *  product-sums. Refused — a box whose first bound is a NaN, which a successful one never holds,
 *  its bounds finite — for a non-finite or inverted box, a denominator interval reaching zero, an
 *  overflow or a non-finite result. */
export const dEncloseTransform = wgslFn(
  'dEncloseTransform',
  [
    DoubleEnclosure,
    dBoxTransform,
    dAbs,
    dAdd,
    dDiv,
    dMul,
    dSub,
    dNan,
    dBelow,
    dMathMax,
    dMathMin,
    dAxisReach,
    dIsFinite,
    D_ROUND,
    D_GAMMA,
    D_FLUSH,
    D_FLOAT32_MAX,
  ],
  `fn dEncloseTransform(box:array<vec2u,6>,m:array<vec2u,16>)->DoubleEnclosure{
 var out=box;
 var error:array<vec2u,3>;
 out[0]=dNan();
 for(var k=0u;k<6u;k++){if(!dIsFinite(box[k])){return DoubleEnclosure(out,error);}}
 for(var axis=0u;axis<3u;axis++){if(dBelow(box[axis+3u],box[axis])){return DoubleEnclosure(out,error);}}
 var minimumW=m[15];
 var maximumW=m[15];
 var magnitudeW=dAbs(m[15]);
 for(var axis=0u;axis<3u;axis++){
  let a=dMul(m[axis*4u+3u],box[axis]);
  let b=dMul(m[axis*4u+3u],box[axis+3u]);
  minimumW=dAdd(minimumW,dMathMin(a,b));
  maximumW=dAdd(maximumW,dMathMax(a,b));
  magnitudeW=dAdd(magnitudeW,dMathMax(dAbs(a),dAbs(b)));
 }
 let errorW=dAdd(dMul(D_GAMMA,magnitudeW),D_FLUSH);
 if(!dBelow(errorW,minimumW)||!dIsFinite(maximumW)){return DoubleEnclosure(out,error);}
 out=dBoxTransform(box,m);
 for(var axis=0u;axis<3u;axis++){
  var magnitude=dAbs(m[12u+axis]);
  for(var column=0u;column<3u;column++){
   let reach=dAxisReach(box[column],box[column+3u]);
   magnitude=dAdd(magnitude,dMul(dAbs(m[column*4u+axis]),reach));
  }
  if(!dBelow(magnitude,D_FLOAT32_MAX)){
   out[0]=dNan();
   return DoubleEnclosure(out,error);
  }
  let bound=dAxisReach(out[axis],out[axis+3u]);
  let spread=dAdd(dAdd(dMul(D_GAMMA,magnitude),D_FLUSH),dMul(bound,errorW));
  error[axis]=dAdd(dDiv(spread,dSub(minimumW,errorW)),dMul(D_ROUND,bound));
  out[axis]=dSub(out[axis],error[axis]);
  out[axis+3u]=dAdd(out[axis+3u],error[axis]);
 }
 for(var k=0u;k<6u;k++){
  if(!dIsFinite(out[k])){
   out[0]=dNan();
   return DoubleEnclosure(out,error);
  }
 }
 return DoubleEnclosure(out,error);
}`,
)
