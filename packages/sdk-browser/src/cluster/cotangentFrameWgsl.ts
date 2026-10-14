import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { DIVISOR_FLOOR } from '../../../math/src/wgsl/constants.ts'
import { unitOrZero } from '../../../math/src/wgsl/inverseTranspose.ts'

/**
 * The tangent frame a page does not store, from the triangle: its normal `N`, two edges and the
 * texture deltas along them. A raster passes the triangle's own edges and deltas, a fragment
 * stage the screen derivatives of position and texture coordinate — the same frame either way,
 * the one every lighting pass of the engine bends its normal map with. `T` follows `u`, `B`
 * follows `v`, both orthogonal to `N`, the longer of the two unit; a triangle with no texture
 * area yields zero vectors, not NaN.
 */
export const COTANGENT_FRAME_WGSL = wgslBlock(
  'COTANGENT_FRAME_WGSL',
  [DIVISOR_FLOOR, unitOrZero],
  `struct CotangentFrame{T:vec3f,B:vec3f,}
fn cotangentFrame(N:vec3f,e1:vec3f,e2:vec3f,duv1:vec2f,duv2:vec2f)->CotangentFrame{
 let p=cross(e2,N);let q=cross(N,e1);
 let T=p*duv1.x+q*duv2.x;let B=p*duv1.y+q*duv2.y;
 let scale=inverseSqrt(max(max(dot(T,T),dot(B,B)),DIVISOR_FLOOR));
 return CotangentFrame(T*scale,B*scale);
}
/** The normal N bent by a tangent-space map value m over the frame T, B: unit, or zero. */
fn bendNormal(N:vec3f,T:vec3f,B:vec3f,m:vec3f)->vec3f{return unitOrZero(T*m.x+B*m.y+N*m.z);}`,
)
