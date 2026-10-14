import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { dAbs, dAdd, dDiv, dMul, dSub } from '../../../../math/src/wgsl/double.ts'
import { dNan } from '../../../../math/src/wgsl/doubleWords.ts'
import { dBelow, dMathMax, dMathMin } from '../../../../math/src/wgsl/doubleOrder.ts'
import { dIsFinite } from '../../../../math/src/wgsl/doubleRound.ts'
import { dBoxTransform } from '../../../../math/src/wgsl/doubleAffine.ts'
import { wgslDouble } from '../../../../math/src/wgsl/number.ts'
import { FLOAT32_MAX } from '../../../../math/src/constants.ts'
import { FLUSH, ROUND, ROUNDING_GAMMA } from './precision.ts'

/** The doubles the water rectangle computes with, the CPU's constants bit for bit
 *  (`precision.ts`). */
export const WATER_DOUBLES_WGSL = wgslBlock(
  'WATER_DOUBLES_WGSL',
  [],
  `const D_ZERO=${wgslDouble(0)};
const D_ONE=${wgslDouble(1)};
const D_HALF=${wgslDouble(0.5)};
const D_TWO=${wgslDouble(2)};
const D_INFINITY=${wgslDouble(Infinity)};
const D_NEG_INFINITY=${wgslDouble(-Infinity)};
const D_ROUND=${wgslDouble(ROUND)};
const D_GAMMA=${wgslDouble(ROUNDING_GAMMA)};
const D_FLUSH=${wgslDouble(FLUSH)};
const D_FLOAT32_MAX=${wgslDouble(FLOAT32_MAX)};
const D_THICKNESS_GUARD=${wgslDouble(1 + 16 * ROUND)};`,
)

/**
 * THE ENCLOSURE OF A BINARY32 TRANSFORM, IN EMULATED DOUBLES (`math/src/wgsl/double.ts`): the CPU's
 * `widenBox`, `boxTransform` (`dBoxTransform`) and `encloseTransform` (`precision.ts`,
 * `math/src/geometry/box.ts`),
 * operation for operation — the same products, the same sums left to right, `Math.min` and
 * `Math.max` with their NaN (`dMathMin`) —, so each bound is the CPU's to the bit. A box is six
 * doubles, its minima then its maxima. An enclosure the CPU refuses returns a box whose first
 * bound is a NaN, which a successful one never holds (its bounds are finite); the error it adds to
 * each nominal coordinate is left in `encloseError`, as the CPU leaves it in its scratch.
 */
export const WATER_ENCLOSE_WGSL = wgslBlock(
  'WATER_ENCLOSE_WGSL',
  [
    WATER_DOUBLES_WGSL,
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
    dIsFinite,
  ],
  `var<private> encloseError:array<vec2u,3>;
/** \`widenBox(box, distance)\`: each axis grown by \`distance\` and its binary32 rounding guard. */
fn waterWiden(box:array<vec2u,6>,distance:vec2u)->array<vec2u,6>{
 var out=box;
 for(var axis=0u;axis<3u;axis++){
  let error=dAdd(dMul(dMathMax(dAbs(box[axis]),dAbs(box[axis+3u])),D_GAMMA),D_FLUSH);
  let grow=dAdd(distance,error);
  out[axis]=dSub(box[axis],grow);
  out[axis+3u]=dAdd(box[axis+3u],grow);
 }
 return out;
}
/** How far the pose \`m\` stretches a length, bounded: the larger of its linear part's column and
 *  row sums of magnitudes, \`max(‖M‖₁, ‖M‖∞)\`, above its largest singular value — the most a
 *  volume's declared thickness grows to the world (\`volumeWorldPath\`); 1 for a rigid pose along
 *  the axes. It is that law's cap, not the cut's \`maxStretchBits\` (the largest singular value of
 *  a root's world): the composite's single-precision path, its cofactors rounded, may exceed the
 *  singular value but never this bound, and the item's pose is not its root's. \`waterStretch\` of
 *  the CPU (\`waterRect.fixture.ts\`), sum for sum. */
fn waterStretch(m:array<vec2u,16>)->vec2u{
 var stretch=D_ZERO;
 for(var k=0u;k<3u;k++){
  let column=dAdd(dAdd(dAbs(m[k*4u]),dAbs(m[k*4u+1u])),dAbs(m[k*4u+2u]));
  let row=dAdd(dAdd(dAbs(m[k]),dAbs(m[4u+k])),dAbs(m[8u+k]));
  stretch=dMathMax(dMathMax(stretch,column),row);
 }
 return stretch;
}
/** \`encloseTransform(box, m)\`: the transformed box widened by the absolute error of its
 *  binary32 product-sums; refused (a NaN first bound) for a non-finite or inverted box, a
 *  denominator interval reaching zero, an overflow or a non-finite result. */
fn waterEnclose(box:array<vec2u,6>,m:array<vec2u,16>)->array<vec2u,6>{
 var out=box;
 out[0]=dNan();
 for(var k=0u;k<6u;k++){if(!dIsFinite(box[k])){return out;}}
 for(var axis=0u;axis<3u;axis++){if(dBelow(box[axis+3u],box[axis])){return out;}}
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
 if(!dBelow(errorW,minimumW)||!dIsFinite(maximumW)){return out;}
 out=dBoxTransform(box,m);
 for(var axis=0u;axis<3u;axis++){
  var magnitude=dAbs(m[12u+axis]);
  for(var column=0u;column<3u;column++){
   let reach=dMathMax(dAbs(box[column]),dAbs(box[column+3u]));
   magnitude=dAdd(magnitude,dMul(dAbs(m[column*4u+axis]),reach));
  }
  if(!dBelow(magnitude,D_FLOAT32_MAX)){
   out[0]=dNan();
   return out;
  }
  let bound=dMathMax(dAbs(out[axis]),dAbs(out[axis+3u]));
  let spread=dAdd(dAdd(dMul(D_GAMMA,magnitude),D_FLUSH),dMul(bound,errorW));
  let error=dAdd(dDiv(spread,dSub(minimumW,errorW)),dMul(D_ROUND,bound));
  encloseError[axis]=error;
  out[axis]=dSub(out[axis],error);
  out[axis+3u]=dAdd(out[axis+3u],error);
 }
 for(var k=0u;k<6u;k++){
  if(!dIsFinite(out[k])){
   out[0]=dNan();
   return out;
  }
 }
 return out;
}`,
)
