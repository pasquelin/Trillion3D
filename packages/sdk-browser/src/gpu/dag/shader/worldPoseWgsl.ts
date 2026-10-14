import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { toF32 } from '../../../../../math/src/wgsl/f32.ts'
import { dSub } from '../../../../../math/src/wgsl/double.ts'

/**
 * A translation at an eye: the exact one beside a placement's matrix in its record
 * (`../worldTable.ts`) — three doubles (`../worldOrigins.ts`) — less the eye's, in double, then
 * rounded once to single precision: the bits the host's `Math.fround(t - eye)` writes
 * (`worldToRenderOrigin`). The world at an eye takes it here (`worldAtEyeWgsl`).
 */
const TRANSLATION_AT_EYE_WGSL = wgslBlock(
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
 * The world at an eye of the world table bound as `name` (`../worldTable.ts`):
 * `<name>WorldAtEye(w,e0,e1)`, its matrix's columns (`<name>Column`) with the translation at the eye
 * `e0`, `e1` (`TRANSLATION_AT_EYE_WGSL`). Listed by the programs that take an eye alone — a cut at
 * its view's (`DAG_WORLD_POSE_WGSL`), a ray at its origin
 * (`../../../webgpu/rays/rayPlacementWgsl.ts`) —: the double emulation stays out of the others.
 */
export const worldAtEyeWgsl = (name: string) =>
  wgslBlock(
    `worldAtEye(${name})`,
    [TRANSLATION_AT_EYE_WGSL],
    `fn ${name}WorldAtEye(w:u32,e0:vec4u,e1:vec4u)->mat4x4f{
 let t=bitcast<vec3f>(translationAtEye(${name}Origin(w,0u),${name}Origin(w,1u),e0,e1));
 return mat4x4f(${name}Column(w,0u),${name}Column(w,1u),${name}Column(w,2u),vec4f(t,${name}Column(w,3u).w));
}`,
  )

/**
 * A primitive's world pose at the cut's eye, and its frustum planes' first vec4 in `frames`, per
 * view slot. The matrices hold the linear part; the translation is read where the cut reads it,
 * the worlds' record, at the view's eye (`eye`, the view's `cameraWorld` in doubles, `TRANSLATION_AT_EYE_WGSL`). No
 * pass brings every placement to a moving eye: the work follows the placements a cut reads.
 */
export const DAG_WORLD_POSE_WGSL = wgslBlock(
  'DAG_WORLD_POSE_WGSL',
  [worldAtEyeWgsl('worlds')],
  `
/** Primitive \`w\`'s world at the eye, read in its record (\`worldsWorldAtEye\`). */
fn worldPose(w:u32)->mat4x4f{return worldsWorldAtEye(w,views[0u].eye[0],views[0u].eye[1]);}
`,
)
