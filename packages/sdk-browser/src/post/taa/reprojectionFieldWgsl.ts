import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'

/** The formats of the reprojection field's words a render texel: its vector (the hole-filled one), its jacobian and its boundary, one unsigned word each. */
export const FIELD_FORMAT: GPUTextureFormat = 'r32uint'
/** The layers of the field's texture, which the history reprojection and the shading rejection
 *  store to together: the vector, then the jacobian where the level reprojects by the field; the
 *  boundary is a texture of its own, which only the nearest velocity writes. */
export const FIELD_LAYERS = { vector: 0, jacobian: 1 } as const

/** The jacobian's components are held to ±`JACOBIAN_RANGE`, in 8 bits each. */
const JACOBIAN_RANGE = 2
const JACOBIAN_BITS = 8
const JACOBIAN_STEPS = (1 << (JACOBIAN_BITS - 1)) - 1
/** The boundary's two components in 11 bits each, above the 4 of the dilating offset. */
const BOUNDARY_STEPS = 1023
const BOUNDARY_BIAS = 1024
const BOUNDARY_MOST = 2047

/** The offset of a render texel that dilates its reprojection: the texel it took the vector of, in
 *  [-1, 1]² (`encodeReprojectionOffset`, nine codes, `NO_OFFSET` the texel itself). */
const offsetCode = (x: number, y: number) => x + 1 + 4 * (y + 1)

/** The boundary word of a texel that dilates by no offset and is wholly dilated: the offset 0 and
 *  the boundary `(0, 1)` — a history pixel is then read at the texel's own, with no correction
 *  from its neighbour (`encodeReprojectionBoundary`). */
const NO_BOUNDARY_WORD = offsetCode(0, 0) | (BOUNDARY_BIAS << 4) | (BOUNDARY_MOST << 15)

/**
 * THE REPROJECTION FIELD'S WORDS. A render texel keeps, beside its reprojection vector, a jacobian
 * — how the vector changes a pixel along each axis, so a history pixel inside the texel is
 * reprojected by `vector + coordinate · jacobian` rather than by the vector alone — and a boundary,
 * which says where inside the texel its neighbour's vector, at the offset the dilation took it from,
 * stops being the one to use:
 * - `encodeReprojectionJacobian`, `decodeReprojectionJacobian`: the two columns `(j0, j1)` of the
 *   jacobian, each component held to ±2, its square root's sign-kept companding in 8 bits, four
 *   in a word;
 * - `encodeReprojectionBoundary`, `decodeReprojectionOffset`, `decodeReprojectionBoundary`: the
 *   dilating offset in the first 4 bits (two bits an axis, the value plus one), the boundary's two
 *   components, in [-1, 1] on 11 bits each, above it;
 * - `historyWithinBoundary`: whether the history pixel `ko` render pixels off the texel's centre,
 *   `historyToInput` render pixels wide, lies on the offset's side of the boundary;
 * - `reprojectionUpscale`: how much the jacobian stretches the reprojected history, 1 or more.
 */
export const REPROJECTION_FIELD_WGSL = wgslBlock(
  'REPROJECTION_FIELD_WGSL',
  [],
  `
const NO_BOUNDARY_WORD:u32=${NO_BOUNDARY_WORD}u;
fn encodeReprojectionOffset(o:vec2i)->u32{return u32(o.x+1)+4u*u32(o.y+1);}
fn encodeReprojectionBoundary(o:vec2i,b:vec2f)->u32{
 let bits=clamp(vec2i(round(b*${wgslF32(BOUNDARY_STEPS)}))+vec2i(${BOUNDARY_BIAS}),vec2i(1),vec2i(${BOUNDARY_MOST}));
 return encodeReprojectionOffset(o)|(u32(bits.x)<<4u)|(u32(bits.y)<<15u);
}
fn decodeReprojectionOffset(word:u32)->vec2i{return vec2i(i32(word&3u),i32((word>>2u)&3u))-vec2i(1);}
fn decodeReprojectionBoundary(word:u32)->vec2f{
 let bits=vec2i(i32((word>>4u)&${BOUNDARY_MOST}u),i32((word>>15u)&${BOUNDARY_MOST}u))-vec2i(${BOUNDARY_BIAS});
 return clamp(vec2f(bits)/${wgslF32(BOUNDARY_STEPS)},vec2f(-1.0),vec2f(1.0));
}
fn historyWithinBoundary(ko:vec2f,boundary:vec2f,historyToInput:f32)->bool{
 let toCorner=vec2f(0.5)-select(vec2f(0.0),vec2f(1.0),boundary<vec2f(0.0));
 let centre=toCorner*historyToInput;
 let rel=boundary-toCorner+ko+centre;
 return dot(rel,boundary)>0.0;
}
fn encodeReprojectionJacobian(j0:vec2f,j1:vec2f)->u32{
 let range=${wgslF32(JACOBIAN_RANGE)};
 let a=clamp(j0,vec2f(-range),vec2f(range));let b=clamp(j1,vec2f(-range),vec2f(range));
 let ca=sign(a)*sqrt(abs(a))*${wgslF32(Math.sqrt(JACOBIAN_RANGE))};
 let cb=sign(b)*sqrt(abs(b))*${wgslF32(Math.sqrt(JACOBIAN_RANGE))};
 let multiply=${wgslF32(JACOBIAN_STEPS / JACOBIAN_RANGE)};let offset=${wgslF32(JACOBIAN_STEPS + 0.5)};
 let da=vec2u(multiply*ca+vec2f(offset));let db=vec2u(multiply*cb+vec2f(offset));
 return da.x|(da.y<<8u)|(db.x<<16u)|(db.y<<24u);
}
struct TaaJacobian{j0:vec2f,j1:vec2f}
fn decodeReprojectionJacobian(word:u32)->TaaJacobian{
 let da=vec2f(f32(word&0xffu),f32((word>>8u)&0xffu));
 let db=vec2f(f32((word>>16u)&0xffu),f32((word>>24u)&0xffu));
 let multiply=${wgslF32(JACOBIAN_RANGE / JACOBIAN_STEPS)};let range=${wgslF32(JACOBIAN_RANGE)};
 let a=da*multiply-vec2f(range);let b=db*multiply-vec2f(range);
 return TaaJacobian(a*abs(a)*${wgslF32(1 / JACOBIAN_RANGE)},b*abs(b)*${wgslF32(1 / JACOBIAN_RANGE)});
}
fn reprojectionUpscale(j:TaaJacobian)->f32{
 let e=vec2f(1.0,0.0)+j.j0;let s=vec2f(0.0,1.0)+j.j1;
 return sqrt(max(dot(e,e),1.0)*max(dot(s,s),1.0));
}`,
)
