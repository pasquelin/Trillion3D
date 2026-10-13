import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { toF32 } from '../../../../../math/src/wgsl/f32.ts'
import { dSub } from '../../../../../math/src/wgsl/double.ts'

/**
 * A primitive's world pose at the cut's eye, and its frustum planes' first vec4 in `frames`, per
 * view slot. The matrices hold the linear part; the translation is read where the cut reads it:
 * the exact one beside the matrix in the worlds' record (`../worldTable.ts`) — three doubles
 * (`../worldOrigins.ts`) — less the
 * eye's (`eye`, the view's `cameraWorld` in doubles), in double, then rounded once to single
 * precision: the bits the host's `Math.fround(t - eye)` writes (`worldToRenderOrigin`). No pass
 * brings every placement to a moving eye: the work follows the placements a cut reads.
 */
export const DAG_WORLD_POSE_WGSL = wgslBlock(
  'DAG_WORLD_POSE_WGSL',
  [toF32, dSub],
  `
/** One coordinate of a translation at the eye: the exact double \`t\` less the eye's \`e\`, as a
 *  single-precision word. */
fn atEye(t:vec2u,e:vec2u)->u32{return toF32(dSub(t,e));}
/** The three single-precision words of a translation at the eye, from its doubles' words \`a\`, \`b\`
 *  and the eye's \`e0\`, \`e1\` — whole words, never a float move. */
fn translationAtEye(a:vec4u,b:vec4u,e0:vec4u,e1:vec4u)->vec3u{
 return vec3u(atEye(a.xy,e0.xy),atEye(a.zw,e0.zw),atEye(b.xy,e1.xy));
}
/** Primitive \`w\`'s world at the eye. \`worlds\` is read as words: the doubles beside the matrix
 *  reach the subtraction bit for bit on a backend that flushes or canonicalises float moves; the
 *  matrix is taken as floats, words 12 to 14 never read (the translation is made here). */
fn worldPose(w:u32)->mat4x4f{
 let t=bitcast<vec3f>(translationAtEye(worldsOrigin(w,0u),worldsOrigin(w,1u),views[0u].eye[0],views[0u].eye[1]));
 let c=bitcast<vec4f>(worldsMatrix(w,3u));
 return mat4x4f(bitcast<vec4f>(worldsMatrix(w,0u)),bitcast<vec4f>(worldsMatrix(w,1u)),bitcast<vec4f>(worldsMatrix(w,2u)),vec4f(t,c.w));
}
`,
)
