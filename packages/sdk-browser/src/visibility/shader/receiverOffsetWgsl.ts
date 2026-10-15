import { SHADING_POINT_WGSL } from './shadingPoint.ts'
import { SHADOW_RECEIVER_STRUCT_WGSL } from './receiverTargetWgsl.ts'
import { faceNormal } from '../../../../math/src/wgsl/geometry.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'

/**
 * THE SHADOW RECEIVER OF A PIXEL, made once by the resolve, which has its triangle decoded: its
 * shading-point offset (the Phong projection, `shadingPointOffset`) and its triangle's plane, the
 * one the shadow bias follows. The resolve stores it in the receiver target (8 B/px,
 * `receiverTargetWgsl.ts`); the projection and the deferred lighting read it there, never decoding the
 * triangle again.
 */
/**
 * The receiver of a pixel whose triangle is decoded: its barycentrics `bary` in the world corners
 * `w0 w1 w2`, their vertex normals `n0 n1 n2` turned to the side `lit` (±1) the shading lights,
 * the Phong projection of its point (`shadingPointOffset`) and the triangle's own plane, which the
 * shadow bias follows (`vsmBiasNormal`), not normalised. The resolve's arithmetic: it writes the receiver
 * target once (`receiverTargetWgsl.ts`), which every shadow read takes its receiver from.
 */
export const SHADOW_RECEIVER_OF_TRIANGLE_WGSL = wgslBlock(
  'SHADOW_RECEIVER_OF_TRIANGLE_WGSL',
  [SHADOW_RECEIVER_STRUCT_WGSL, SHADING_POINT_WGSL, faceNormal],
  `fn shadowReceiverOfTriangle(bary:vec3f,w0:vec4f,w1:vec4f,w2:vec4f,n0:vec3f,n1:vec3f,n2:vec3f,lit:f32)->ShadowReceiver{
 let P=(w0*bary.x+w1*bary.y+w2*bary.z).xyz;
 return ShadowReceiver(shadingPointOffset(P,bary,w0.xyz,w1.xyz,w2.xyz,n0*lit,n1*lit,n2*lit),faceNormal(w0.xyz,w1.xyz,w2.xyz));
}`,
)
