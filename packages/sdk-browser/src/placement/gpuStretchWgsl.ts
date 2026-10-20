/**
 * The primitive stretch of a moved root, on the GPU: `maxStretch` of the root's double world
 * (`math/src/projection/projectionOracles.ts`), which the root boxes pass writes — its one writer —
 * into the `Stretch` field of the cut's frame words (`roots/rootBoxesWgsl.ts`, `../geometry/dag/frameTable.ts`),
 * the number the cut projects every error through. The CPU's memo of it (`worldStretch`) serves the
 * CPU's own readers alone (`../deformation/screen.ts`), never the cut; it takes
 * the largest singular value of the linear part in doubles — the symmetric matrix `AᵀA`, its
 * eigenvalue by the trigonometric solution of a cubic —; so does this, in the same doubles
 * (`math/src/wgsl/double.ts`), every product and sum rounded once as the CPU rounds it, and the
 * result stored as a `Float32Array` stores it.
 *
 * The one part that is not the CPU's operation is the cosine of a third of an arc cosine
 * (`cos(acos(x)/3)`), which is the largest root `t` of `4t³ − 3t = x` (the cubic's own definition):
 * solved here by Newton's method from a single-precision start, two or three corrections in double
 * precision with a single-precision reciprocal of the slope — each gaining the reciprocal's seven
 * digits — close to a unit of the double's last place, near an arc cosine of π by the root's shift
 * from 1/2 (`6u² + 4u³ = 1 + x`, `t = 1/2 + u`, well conditioned where the first is not). The
 * rounding of that root, a few units of the last place of a double, reaches the single-precision
 * word only where the value lies within them of a rounding boundary.
 */
import { wgslDouble } from '../../../math/src/wgsl/number.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import {
  dAdd,
  dDiv,
  dDot3,
  dLess,
  dMul,
  dSqrt,
  dRsqrt,
  dSub,
} from '../../../math/src/wgsl/double.ts'
import { dIsFinite } from '../../../math/src/wgsl/doubleRound.ts'
import { dIsZero } from '../../../math/src/wgsl/doubleWords.ts'
import { fromF32, toF32 } from '../../../math/src/wgsl/f32.ts'
import { D_HALF, D_ONE, D_TWO, D_ZERO } from '../../../math/src/wgsl/doubleConstants.ts'

/** The largest root of `4t³ − 3t = x`, `x` in [−1, 1], in double precision. */
const CHEBYSHEV_WGSL = wgslBlock(
  'CHEBYSHEV_WGSL',
  [dAdd, dSub, dMul, dLess, fromF32, toF32, D_ONE, D_HALF],
  `fn chebyshevRoot(x:vec2u)->vec2u{
 let xf=bitcast<f32>(toF32(x));
 if(dLess(x,${wgslDouble(-0.5)})){
  // Near −1 the root is 1/2 + u: 6u² + 4u³ = 1 + x, which the root's flat slope hides from the first form.
  let y=dAdd(D_ONE,x);
  let yf=max(bitcast<f32>(toF32(y)),0.0);
  var uf=sqrt(yf/6.0);
  if(uf<=0.0){return D_HALF;}
  for(var i=0u;i<8u;i++){uf=uf-(4.0*uf*uf*uf+6.0*uf*uf-yf)/(12.0*uf*(uf+1.0));}
  let slope=fromF32(bitcast<u32>(1.0/(12.0*uf*(uf+1.0))));
  var u=fromF32(bitcast<u32>(uf));
  for(var i=0u;i<3u;i++){
   let u2=dMul(u,u);
   let g=dSub(dAdd(dMul(${wgslDouble(4)},dMul(u2,u)),dMul(${wgslDouble(6)},u2)),y);
   u=dSub(u,dMul(g,slope));
  }
  return dAdd(D_HALF,u);
 }
 var tf=0.9;
 for(var i=0u;i<8u;i++){tf=tf-(4.0*tf*tf*tf-3.0*tf-xf)/(12.0*tf*tf-3.0);}
 let slope=fromF32(bitcast<u32>(1.0/(12.0*tf*tf-3.0)));
 var t=fromF32(bitcast<u32>(tf));
 for(var i=0u;i<3u;i++){
  let t2=dMul(t,t);
  let f=dSub(dSub(dMul(${wgslDouble(4)},dMul(t2,t)),dMul(${wgslDouble(3)},t)),x);
  t=dSub(t,dMul(f,slope));
 }
 return t;
}`,
)

/**
 * `maxStretch` of the matrix whose sixteen doubles are `m`, as a double (`math/src/projection/
 * projectionOracles.ts`): the largest singular value of the linear part, the arithmetic of the CPU's
 * in the doubles the GPU composes. A world the stretch's callers refuse (a number that is no finite
 * one) is theirs to leave out.
 */
export const STRETCH_DOUBLE_WGSL = wgslBlock(
  'STRETCH_DOUBLE_WGSL',
  [
    dAdd,
    dSub,
    dMul,
    dDot3,
    dDiv,
    dLess,
    dIsZero,
    dSqrt,
    dRsqrt,
    CHEBYSHEV_WGSL,
    D_ZERO,
    D_HALF,
    D_ONE,
    D_TWO,
  ],
  `fn maxStretchOf(m:array<vec2u,16>)->vec2u{
 let a=m[0];let b=m[4];let c=m[8];
 let d=m[1];let e=m[5];let f=m[9];
 let g=m[2];let h=m[6];let i=m[10];
 let m00=dDot3(a,a,d,d,g,g);
 let m11=dDot3(b,b,e,e,h,h);
 let m22=dDot3(c,c,f,f,i,i);
 let m01=dDot3(a,b,d,e,g,h);
 let m02=dDot3(a,c,d,f,g,i);
 let m12=dDot3(b,c,e,f,h,i);
 let off=dDot3(m01,m01,m02,m02,m12,m12);
 // Sums of squares are never negative: the largest compares by its value.
 var top=m00;
 if(dLess(top,m11)){top=m11;}
 if(dLess(top,m22)){top=m22;}
 if(dIsZero(off)){return dSqrt(top);}
 let mean=dDiv(dAdd(dAdd(m00,m11),m22),${wgslDouble(3)});
 let d0=dSub(m00,mean);let d1=dSub(m11,mean);let d2=dSub(m22,mean);
 let spreadSquared=dDiv(dAdd(dDot3(d0,d0,d1,d1,d2,d2),dMul(D_TWO,off)),${wgslDouble(6)});
 if(dIsZero(spreadSquared)){
  if(dLess(mean,D_ZERO)){return D_ZERO;}
  return dSqrt(mean);
 }
 let r=dRsqrt(spreadSquared);
 let spread=dMul(spreadSquared,r);
 let b00=dMul(d0,r);let b11=dMul(d1,r);let b22=dMul(d2,r);
 let b01=dMul(m01,r);let b02=dMul(m02,r);let b12=dMul(m12,r);
 let determinant=dAdd(
  dSub(dMul(b00,dSub(dMul(b11,b22),dMul(b12,b12))),dMul(b01,dSub(dMul(b01,b22),dMul(b12,b02)))),
  dMul(b02,dSub(dMul(b01,b12),dMul(b11,b02))));
 var x=dMul(determinant,D_HALF);
 if(dLess(x,${wgslDouble(-1)})){x=${wgslDouble(-1)};}
 if(dLess(D_ONE,x)){x=D_ONE;}
 let t=chebyshevRoot(x);
 let value=dAdd(mean,dMul(dMul(D_TWO,spread),t));
 if(dLess(value,D_ZERO)){return D_ZERO;}
 return dSqrt(value);
}`,
)

/**
 * The single-precision bits of `stretch`, the `maxStretchOf` of the world whose sixteen doubles are
 * `m`: the bits the root boxes pass writes into the frame words' `Stretch` field
 * (`../geometry/dag/frameTable.ts`) — those a `Float32Array` stores of the CPU's; all ones for a world
 * holding a number that is no finite one, where the CPU refuses the matrix (the stretch is then
 * left as it was).
 */
export const STRETCH_WGSL = wgslBlock(
  'STRETCH_WGSL',
  [toF32, dIsFinite],
  `fn stretchBits(m:array<vec2u,16>,stretch:vec2u)->u32{
 for(var k=0u;k<16u;k++){if(!dIsFinite(m[k])){return 0xffffffffu;}}
 return toF32(stretch);
}`,
)
