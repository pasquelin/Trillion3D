import { wgslFn } from '../../../../math/src/wgsl/decl.ts'

/**
 * THE UNSIGNED SMALL FLOATS of the 11-11-10 word, which a pass keeps its light in where core WebGPU has no storage
 * format of that name (`r32uint` holds it, and reads and writes it alone):
 * - `packSmallFloat`, `unpackSmallFloat`: a number as the field of `mantissa` bits after five of exponent,
 *   rounded to nearest, held to the format's range (0 to 65024 at six bits, 64512 at five) — below 2⁻¹⁴ the
 *   field is a denormal —, and back;
 * - `packLight`, `unpackLight`: a colour's three channels in the word, the first two of six bits of mantissa, the
 *   third of five, the first in the low bits; a channel under zero is zero.
 */
export const packSmallFloat = wgslFn(
  'packSmallFloat',
  [],
  `fn packSmallFloat(x:f32,mantissa:u32)->u32{
 let top=(30u<<mantissa)|((1u<<mantissa)-1u);
 let v=clamp(x,0.0,131008.0);
 if(v<6.103515625e-5){return min(u32(round(v*f32(1u<<(14u+mantissa)))),top);}
 let shift=23u-mantissa;
 let bits=bitcast<u32>(v);
 return min((((bits>>23u)-112u)<<mantissa)+(((bits&0x7fffffu)+(1u<<(shift-1u)))>>shift),top);
}`,
)

export const unpackSmallFloat = wgslFn(
  'unpackSmallFloat',
  [],
  `fn unpackSmallFloat(field:u32,mantissa:u32)->f32{
 let exponent=field>>mantissa;
 let fraction=field&((1u<<mantissa)-1u);
 if(exponent==0u){return f32(fraction)/f32(1u<<(14u+mantissa));}
 return bitcast<f32>(((exponent+112u)<<23u)|(fraction<<(23u-mantissa)));
}`,
)

export const packLight = wgslFn(
  'packLight',
  [packSmallFloat],
  'fn packLight(c:vec3f)->u32{return packSmallFloat(c.x,6u)|(packSmallFloat(c.y,6u)<<11u)|(packSmallFloat(c.z,5u)<<22u);}',
)

export const unpackLight = wgslFn(
  'unpackLight',
  [unpackSmallFloat],
  'fn unpackLight(w:u32)->vec3f{return vec3f(unpackSmallFloat(w&0x7ffu,6u),unpackSmallFloat((w>>11u)&0x7ffu,6u),unpackSmallFloat(w>>22u,5u));}',
)
