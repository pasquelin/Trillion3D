import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { toF32 } from '../../../../../math/src/wgsl/f32.ts'
import { dSub } from '../../../../../math/src/wgsl/double.ts'

/**
 * A translation at an eye: the exact one beside a placement's matrix in its record
 * (`../worldTable.ts`) — three doubles (`../worldOrigins.ts`) — less the eye's, in double, then
 * rounded once to single precision: the bits the host's `Math.fround(t - eye)` writes
 * (`worldToRenderOrigin`). The world table's one reader of a placement's world takes it here
 * (`../worldTable.ts`, `<name>WorldAtEye`): a cut at its view's eye (`DAG_WORLD_POSE_WGSL`), a ray
 * at its origin (`../../../webgpu/rays/rayPlacementWgsl.ts`), the proxy at a zero eye.
 */
export const TRANSLATION_AT_EYE_WGSL = wgslBlock(
  'TRANSLATION_AT_EYE_WGSL',
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
`,
)

/**
 * A primitive's world pose at the cut's eye, and its frustum planes' first vec4 in `frames`, per
 * view slot. The matrices hold the linear part; the translation is read where the cut reads it,
 * the worlds' record, at the view's eye (`eye`, the view's `cameraWorld` in doubles, `TRANSLATION_AT_EYE_WGSL`). No
 * pass brings every placement to a moving eye: the work follows the placements a cut reads.
 */
export const DAG_WORLD_POSE_WGSL = wgslBlock(
  'DAG_WORLD_POSE_WGSL',
  [],
  `
/** Primitive \`w\`'s world at the eye, read in its record (\`worldsWorldAtEye\`). */
fn worldPose(w:u32)->mat4x4f{return worldsWorldAtEye(w,views[0u].eye[0],views[0u].eye[1]);}
`,
)
