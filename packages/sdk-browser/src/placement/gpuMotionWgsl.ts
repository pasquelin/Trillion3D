import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { DOUBLE_WGSL } from '../webgpu/blend/doubleWgsl.ts'
import { FROM_F32_WGSL, TO_F32_WGSL } from './f32Wgsl.ts'
/**
 * The temporal motion of a linked placement, on the GPU, word for word the CPU's
 * (`../taa/motion.ts`): `previous · current⁻¹` of the two single-precision worlds the rows hold,
 * widened to double, the inverse by `invertMatrix4`'s cofactors and the product by
 * `multiplyMatrix4`'s, every product, sum and the one reciprocal rounded once as the CPU rounds them
 * (`DOUBLE_WGSL`); its translation column becomes `M · (eye, 1)` in double, as
 * `transformAffinePoint` writes it, then `− eye` and single precision, as `worldToRenderOrigin`
 * stores it.
 */

/** `invertMatrix4`'s cofactors, each a sum taken left to right: `+a*b −c*d …`. */
const COFACTORS = {
  cx: '+yz23*w1 -yz32*w1 +yz31*w2 -yz13*w2 -yz21*w3 +yz12*w3',
  cy: '+xz32*w1 -xz23*w1 -xz31*w2 +xz13*w2 +xz21*w3 -xz12*w3',
  cz: '+xy23*w1 -xy32*w1 +xy31*w2 -xy13*w2 -xy21*w3 +xy12*w3',
  cw: '+xy32*z1 -xy23*z1 -xy31*z2 +xy13*z2 +xy21*z3 -xy12*z3',
}
/** Each entry of the inverse before the reciprocal: a cofactor, or the sum that is one. */
const ENTRIES = [
  'cx',
  '+yz32*w0 -yz23*w0 -yz30*w2 +yz03*w2 +yz20*w3 -yz02*w3',
  '+yz13*w0 -yz31*w0 +yz30*w1 -yz03*w1 -yz10*w3 +yz01*w3',
  '+yz21*w0 -yz12*w0 -yz20*w1 +yz02*w1 +yz10*w2 -yz01*w2',
  'cy',
  '+xz23*w0 -xz32*w0 +xz30*w2 -xz03*w2 -xz20*w3 +xz02*w3',
  '+xz31*w0 -xz13*w0 -xz30*w1 +xz03*w1 +xz10*w3 -xz01*w3',
  '+xz12*w0 -xz21*w0 +xz20*w1 -xz02*w1 -xz10*w2 +xz01*w2',
  'cz',
  '+xy32*w0 -xy23*w0 -xy30*w2 +xy03*w2 +xy20*w3 -xy02*w3',
  '+xy13*w0 -xy31*w0 +xy30*w1 -xy03*w1 -xy10*w3 +xy01*w3',
  '+xy21*w0 -xy12*w0 -xy20*w1 +xy02*w1 +xy10*w2 -xy01*w2',
  'cw',
  '+xy23*z0 -xy32*z0 +xy30*z2 -xy03*z2 -xy20*z3 +xy02*z3',
  '+xy31*z0 -xy13*z0 -xy30*z1 +xy03*z1 +xy10*z3 -xy01*z3',
  '+xy12*z0 -xy21*z0 +xy20*z1 -xy02*z1 -xy10*z2 +xy01*z2',
]

/** `+a*b −c*d …` as WGSL: each product rounded, then each sum, the first term first. */
function sumText(terms: string) {
  let text = ''
  for (const term of terms.split(' ')) {
    const [a, b] = term.slice(1).split('*'),
      product = `dMul(${a},${b})`
    text = text ? `${term[0] === '+' ? 'dAdd' : 'dSub'}(${text},${product})` : product
  }
  return text
}

/** The products of two entries the cofactors share: `yz12` is row y, column 1 times row z, column 2. */
const PRODUCTS = ['yz', 'xz', 'xy'].flatMap((rows) =>
  ['12', '13', '21', '23', '31', '32', '01', '02', '03', '10', '20', '30'].map(
    (columns) => `let ${rows}${columns}=dMul(${rows[0]}${columns[0]},${rows[1]}${columns[1]});`,
  ),
)

/** `m⁻¹` as `invertMatrix4` computes it: the zero matrix for an exactly zero determinant. */
const INVERSE_WGSL = wgslBlock(
  'INVERSE_WGSL',
  [DOUBLE_WGSL],
  `
fn inverse4(m:array<vec2u,16>)->array<vec2u,16>{
${[0, 1, 2, 3].map((c) => ['x', 'y', 'z', 'w'].map((r, i) => `let ${r}${c}=m[${c * 4 + i}];`).join('')).join('\n')}
${PRODUCTS.join('')}
${Object.entries(COFACTORS)
  .map(([name, terms]) => `let ${name}=${sumText(terms)};`)
  .join('\n')}
 let determinant=${sumText('+x0*cx +y0*cy +z0*cz +w0*cw')};
 var out:array<vec2u,16>;
 if(dIsZero(determinant)){
  for(var k=0u;k<16u;k++){out[k]=vec2u(0u,0u);}
  return out;
 }
 let r=dDiv(vec2u(0x3ff00000u,0u),determinant);
${ENTRIES.map((entry, k) => `out[${k}]=dMul(${entry.length === 2 ? entry : sumText(entry)},r);`).join('\n')}
 return out;
}`,
)

/**
 * The sixteen motion words of a root whose single-precision world went from `previous` to
 * `current`, the eye at `eye` (doubles): `previous · current⁻¹`, summed as `multiplyMatrix4` sums,
 * its translation brought to the eye.
 */
export const MOTION_WGSL = wgslBlock(
  'MOTION_WGSL',
  [DOUBLE_WGSL, FROM_F32_WGSL, TO_F32_WGSL, INVERSE_WGSL],
  `fn motionWords(previous:array<u32,16>,current:array<u32,16>,eye:array<vec2u,3>)->array<u32,16>{
 var held:array<vec2u,16>;
 var now:array<vec2u,16>;
 for(var k=0u;k<16u;k++){
  held[k]=fromF32(previous[k]);
  now[k]=fromF32(current[k]);
 }
 let inverse=inverse4(now);
 var m:array<vec2u,16>;
 for(var c=0u;c<4u;c++){
  for(var r=0u;r<4u;r++){
   var sum=dMul(held[r],inverse[c*4u]);
   for(var i=1u;i<4u;i++){sum=dAdd(sum,dMul(held[i*4u+r],inverse[c*4u+i]));}
   m[c*4u+r]=sum;
  }
 }
 var out:array<u32,16>;
 for(var k=0u;k<16u;k++){out[k]=toF32(m[k]);}
 for(var j=0u;j<3u;j++){
  let t=dAdd(dAdd(dAdd(dMul(m[j],eye[0]),dMul(m[4u+j],eye[1])),dMul(m[8u+j],eye[2])),m[12u+j]);
  out[12u+j]=toF32(dSub(t,eye[j]));
 }
 return out;
}`,
)
