/**
 * The primitive stretch of a composed root, on the GPU (`gpuComposeWgsl.ts`): `maxStretch` of the
 * root's single-precision world words (`math/src/projection/projectionOracles.ts`, as
 * `refreshStretchAt` reads them), the number the cut projects every error through. The CPU takes
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
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { dAdd, dDiv, dLess, dMul, dSqrt, dRsqrt, dSub } from '../../../math/src/wgsl/double.ts'
import { dIsZero } from '../../../math/src/wgsl/doubleWords.ts'
import { fromF32, toF32 } from '../../../math/src/wgsl/f32.ts'

/** The largest root of `4t³ − 3t = x`, `x` in [−1, 1], in double precision. */
const CHEBYSHEV_WGSL = wgslBlock(
  'CHEBYSHEV_WGSL',
  [dAdd, dSub, dMul, dLess, fromF32, toF32],
  `fn chebyshevRoot(x:vec2u)->vec2u{
 let xf=bitcast<f32>(toF32(x));
 if(dLess(x,vec2u(0xbfe00000u,0u))){
  // Near −1 the root is 1/2 + u: 6u² + 4u³ = 1 + x, which the root's flat slope hides from the first form.
  let y=dAdd(vec2u(0x3ff00000u,0u),x);
  let yf=max(bitcast<f32>(toF32(y)),0.0);
  var uf=sqrt(yf/6.0);
  if(uf<=0.0){return vec2u(0x3fe00000u,0u);}
  for(var i=0u;i<8u;i++){uf=uf-(4.0*uf*uf*uf+6.0*uf*uf-yf)/(12.0*uf*(uf+1.0));}
  let slope=fromF32(bitcast<u32>(1.0/(12.0*uf*(uf+1.0))));
  var u=fromF32(bitcast<u32>(uf));
  for(var i=0u;i<3u;i++){
   let u2=dMul(u,u);
   let g=dSub(dAdd(dMul(vec2u(0x40100000u,0u),dMul(u2,u)),dMul(vec2u(0x40180000u,0u),u2)),y);
   u=dSub(u,dMul(g,slope));
  }
  return dAdd(vec2u(0x3fe00000u,0u),u);
 }
 var tf=0.9;
 for(var i=0u;i<8u;i++){tf=tf-(4.0*tf*tf*tf-3.0*tf-xf)/(12.0*tf*tf-3.0);}
 let slope=fromF32(bitcast<u32>(1.0/(12.0*tf*tf-3.0)));
 var t=fromF32(bitcast<u32>(tf));
 for(var i=0u;i<3u;i++){
  let t2=dMul(t,t);
  let f=dSub(dSub(dMul(vec2u(0x40100000u,0u),dMul(t2,t)),dMul(vec2u(0x40080000u,0u),t)),x);
  t=dSub(t,dMul(f,slope));
 }
 return t;
}`,
)

/**
 * The single-precision bits of `maxStretch` of the matrix whose words are `w`; all ones for a
 * word that is no finite number, where the CPU refuses the matrix (the stretch is then left as it
 * was).
 */
export const STRETCH_WGSL = wgslBlock(
  'STRETCH_WGSL',
  [dAdd, dSub, dMul, dDiv, dLess, dIsZero, dSqrt, dRsqrt, fromF32, toF32, CHEBYSHEV_WGSL],
  `fn maxStretchBits(w:array<u32,16>)->u32{
 for(var k=0u;k<16u;k++){if(((w[k]>>23u)&0xffu)==0xffu){return 0xffffffffu;}}
 let a=fromF32(w[0]);let b=fromF32(w[4]);let c=fromF32(w[8]);
 let d=fromF32(w[1]);let e=fromF32(w[5]);let f=fromF32(w[9]);
 let g=fromF32(w[2]);let h=fromF32(w[6]);let i=fromF32(w[10]);
 let m00=dAdd(dAdd(dMul(a,a),dMul(d,d)),dMul(g,g));
 let m11=dAdd(dAdd(dMul(b,b),dMul(e,e)),dMul(h,h));
 let m22=dAdd(dAdd(dMul(c,c),dMul(f,f)),dMul(i,i));
 let m01=dAdd(dAdd(dMul(a,b),dMul(d,e)),dMul(g,h));
 let m02=dAdd(dAdd(dMul(a,c),dMul(d,f)),dMul(g,i));
 let m12=dAdd(dAdd(dMul(b,c),dMul(e,f)),dMul(h,i));
 let off=dAdd(dAdd(dMul(m01,m01),dMul(m02,m02)),dMul(m12,m12));
 // Sums of squares are never negative: the largest compares by its value.
 var top=m00;
 if(dLess(top,m11)){top=m11;}
 if(dLess(top,m22)){top=m22;}
 if(dIsZero(off)){return toF32(dSqrt(top));}
 let mean=dDiv(dAdd(dAdd(m00,m11),m22),vec2u(0x40080000u,0u));
 let d0=dSub(m00,mean);let d1=dSub(m11,mean);let d2=dSub(m22,mean);
 let spreadSquared=dDiv(dAdd(dAdd(dAdd(dMul(d0,d0),dMul(d1,d1)),dMul(d2,d2)),dMul(vec2u(0x40000000u,0u),off)),vec2u(0x40180000u,0u));
 if(dIsZero(spreadSquared)){
  if(dLess(mean,vec2u(0u,0u))){return 0u;}
  return toF32(dSqrt(mean));
 }
 let r=dRsqrt(spreadSquared);
 let spread=dMul(spreadSquared,r);
 let b00=dMul(d0,r);let b11=dMul(d1,r);let b22=dMul(d2,r);
 let b01=dMul(m01,r);let b02=dMul(m02,r);let b12=dMul(m12,r);
 let determinant=dAdd(
  dSub(dMul(b00,dSub(dMul(b11,b22),dMul(b12,b12))),dMul(b01,dSub(dMul(b01,b22),dMul(b12,b02)))),
  dMul(b02,dSub(dMul(b01,b12),dMul(b11,b02))));
 var x=dMul(determinant,vec2u(0x3fe00000u,0u));
 if(dLess(x,vec2u(0xbff00000u,0u))){x=vec2u(0xbff00000u,0u);}
 if(dLess(vec2u(0x3ff00000u,0u),x)){x=vec2u(0x3ff00000u,0u);}
 let t=chebyshevRoot(x);
 let value=dAdd(mean,dMul(dMul(vec2u(0x40000000u,0u),spread),t));
 if(dLess(value,vec2u(0u,0u))){return 0u;}
 return toF32(dSqrt(value));
}`,
)
