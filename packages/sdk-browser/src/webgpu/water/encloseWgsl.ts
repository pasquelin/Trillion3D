import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { dAbs, dAdd, dDiv, dMul, dSub } from '../../../../math/src/wgsl/double.ts'
import { dIsZero, dNan } from '../../../../math/src/wgsl/doubleWords.ts'
import { dBelow, dMathMax, dMathMin } from '../../../../math/src/wgsl/doubleOrder.ts'
import { dIsFinite } from '../../../../math/src/wgsl/doubleRound.ts'
import { FLOAT32_MAX } from '../../../../math/src/constants.ts'
import { FLUSH, ROUND, ROUNDING_GAMMA } from './precision.ts'

const cell = new Float64Array(1),
  cellWords = new Uint32Array(cell.buffer)
/** `x` as the shader's double, `vec2u(high word, low word)`: its bits, not a decimal. */
const double = (x: number) => ((cell[0] = x), `vec2u(${cellWords[1]}u,${cellWords[0]}u)`)

/** The doubles the water rectangle computes with, the CPU's constants bit for bit
 *  (`precision.ts`). */
export const WATER_DOUBLES_WGSL = wgslBlock(
  'WATER_DOUBLES_WGSL',
  [],
  `const D_ZERO=vec2u(0u,0u);
const D_ONE=${double(1)};
const D_HALF=${double(0.5)};
const D_TWO=${double(2)};
const D_INFINITY=${double(Infinity)};
const D_ROUND=${double(ROUND)};
const D_GAMMA=${double(ROUNDING_GAMMA)};
const D_FLUSH=${double(FLUSH)};
const D_FLOAT32_MAX=${double(FLOAT32_MAX)};
const D_THICKNESS_GUARD=${double(1 + 16 * ROUND)};`,
)

/**
 * THE ENCLOSURE OF A BINARY32 TRANSFORM, IN EMULATED DOUBLES (`math/src/wgsl/double.ts`): the CPU's
 * `widenBox`, `boxTransform` and `encloseTransform` (`precision.ts`, `math/src/geometry/box.ts`),
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
    dAbs,
    dAdd,
    dDiv,
    dMul,
    dSub,
    dIsZero,
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
/** Row \`row\` of \`m · (x, y, z, 1)\`, \`m\` column-major: \`transformPointRow\`'s sum. */
fn waterRow(m:array<vec2u,16>,row:u32,x:vec2u,y:vec2u,z:vec2u)->vec2u{
 return dAdd(dAdd(dAdd(dMul(m[row],x),dMul(m[4u+row],y)),dMul(m[8u+row],z)),m[12u+row]);
}
/** \`boxTransform\` of a finite box whose minima are not above its maxima: the union of its eight
 *  transformed corners, the divide by \`w\` skipped where the last row is \`0, 0, 0, 1\`. */
fn waterBoxTransform(box:array<vec2u,6>,m:array<vec2u,16>)->array<vec2u,6>{
 let affine=dIsZero(m[3])&&dIsZero(m[7])&&dIsZero(m[11])&&m[15].x==D_ONE.x&&m[15].y==D_ONE.y;
 var out:array<vec2u,6>;
 for(var k=0u;k<3u;k++){
  out[k]=D_INFINITY;
  out[k+3u]=vec2u(D_INFINITY.x|0x80000000u,0u);
 }
 for(var i=0u;i<8u;i++){
  let lx=select(box[0],box[3],(i&1u)!=0u);
  let ly=select(box[1],box[4],(i&2u)!=0u);
  let lz=select(box[2],box[5],(i&4u)!=0u);
  var x=waterRow(m,0u,lx,ly,lz);
  var y=waterRow(m,1u,lx,ly,lz);
  var z=waterRow(m,2u,lx,ly,lz);
  if(!affine){
   let mw=dDiv(D_ONE,waterRow(m,3u,lx,ly,lz));
   x=dMul(x,mw);
   y=dMul(y,mw);
   z=dMul(z,mw);
  }
  out[0]=dMathMin(out[0],x);
  out[1]=dMathMin(out[1],y);
  out[2]=dMathMin(out[2],z);
  out[3]=dMathMax(out[3],x);
  out[4]=dMathMax(out[4],y);
  out[5]=dMathMax(out[5],z);
 }
 return out;
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
 out=waterBoxTransform(box,m);
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
