import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { toF32 } from '../../../../../math/src/wgsl/f32.ts'
import { dSub } from '../../../../../math/src/wgsl/double.ts'
import { invTranspose3Prep } from '../../../../../math/src/wgsl/inverseTranspose.ts'
import { worldMatrix3 } from '../../../../../math/src/wgsl/matrix.ts'

/**
 * A translation at an eye: the exact one beside a placement's matrix in its record
 * (`../worlds/worldTable.ts`) — three doubles (`../worlds/worldOrigins.ts`) — less the eye's, in double, then
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
 * The world at an eye of the world table bound as `name` (`../worlds/worldTable.ts`):
 * `<name>WorldAtEye(w,e0,e1)`, its matrix's columns (`<name>Column`) with the translation at the eye
 * `e0`, `e1` (`TRANSLATION_AT_EYE_WGSL`). Listed by the programs that take an eye alone — a cut at
 * its view's (`DAG_WORLD_POSE_WGSL`), a ray at its origin
 * (`../../../lighting/rays/rayPlacementWgsl.ts`) —: the double emulation stays out of the others.
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
 * The world of the world table bound as `name` as the decode gives the visible rows (`worldOf`,
 * `../../../visibility/decode/decodeWgsl.ts`): `<name>World(w)`, its matrix's columns with the exact
 * translation rounded once (`<name>Translation`) — the frame of a program that draws beside the
 * camera's raster, which reads the rows' worlds whole.
 */
export const worldWgsl = (name: string) =>
  wgslBlock(
    `world(${name})`,
    [],
    `fn ${name}World(w:u32)->mat4x4f{return mat4x4f(${name}Column(w,0u),${name}Column(w,1u),${name}Column(w,2u),vec4f(${name}Translation(w),${name}Column(w,3u).w));}`,
  )

/**
 * A primitive's world pose at the cut's eye, and its frustum planes' first vec4 in `frames`, per
 * view slot. The matrices hold the linear part; the translation is read where the cut reads it,
 * the worlds' record, at the view's eye (`eye`, the view's `cameraWorld` in doubles, `TRANSLATION_AT_EYE_WGSL`). No
 * pass brings every placement to a moving eye: the work follows the placements a cut reads. The pose
 * the previous image drew is read the same way, in the previous poses' record (`../previousPoses.ts`),
 * at THIS image's eye, as the previous image's matrix is composed (`prevViewProj`).
 */
export const DAG_WORLD_POSE_WGSL = wgslBlock(
  'DAG_WORLD_POSE_WGSL',
  [worldAtEyeWgsl('worlds'), worldAtEyeWgsl('previous')],
  `
/** Primitive \`w\`'s world at the eye, read in its record (\`worldsWorldAtEye\`). */
fn worldPose(w:u32)->mat4x4f{return worldsWorldAtEye(w,cutView.eye[0],cutView.eye[1]);}
/** Primitive \`w\`'s world at the eye as the previous image drew it (\`previousWorldAtEye\`). */
fn previousPose(w:u32)->mat4x4f{return previousWorldAtEye(w,cutView.eye[0],cutView.eye[1]);}
`,
)

/**
 * A placement's motion since the last drawn frame, at an eye: `placementMotionAtEye(w,e0,e1)`,
 * `previous · current⁻¹` of its two worlds taken at the eye `e0`, `e1` (`worldAtEyeWgsl`), so a point
 * relative to the eye, where the placement is now, goes where it was, relative to the same eye. The
 * inverse of the affine world is the linear part's by its cofactors (`invTranspose3Prep`, the
 * engine's guard of a degenerate matrix) and the translation it carries back. The identity — no
 * motion — answers a world that is singular and a placement whose two worlds are the same words, so
 * a still placement moves a point by exactly nothing, whatever the rounding of a product.
 *
 * It reads the tables of both poses, which the program lists beside it and binds by the names
 * `worlds` and `previous` (`worldTableWgsl`): the cut's (`DAG_READ_TABLES_WGSL`) and the
 * previous image's (`../previousPoses.ts`, at `DAG_BINDING.previous`).
 */
export const PLACEMENT_MOTION_AT_EYE_WGSL = wgslBlock(
  'PLACEMENT_MOTION_AT_EYE_WGSL',
  [worldAtEyeWgsl('worlds'), worldAtEyeWgsl('previous'), invTranspose3Prep, worldMatrix3],
  `
fn placementMotionAtEye(w:u32,e0:vec4u,e1:vec4u)->mat4x4f{
 let now=worldsWorldAtEye(w,e0,e1);
 let before=previousWorldAtEye(w,e0,e1);
 let back=invTranspose3Prep(worldMatrix3(now));
 let still=!(any(now[0]!=before[0])||any(now[1]!=before[1])||any(now[2]!=before[2])||any(now[3]!=before[3]));
 if(!back.regular||still){
  return mat4x4f(vec4f(1.0,0.0,0.0,0.0),vec4f(0.0,1.0,0.0,0.0),vec4f(0.0,0.0,1.0,0.0),vec4f(0.0,0.0,0.0,1.0));
 }
 let r0=back.adj[0]*back.scale;let r1=back.adj[1]*back.scale;let r2=back.adj[2]*back.scale;
 let t=now[3].xyz;
 let inverse=mat4x4f(vec4f(r0.x,r1.x,r2.x,0.0),vec4f(r0.y,r1.y,r2.y,0.0),vec4f(r0.z,r1.z,r2.z,0.0),vec4f(-dot(r0,t),-dot(r1,t),-dot(r2,t),1.0));
 return before*inverse;
}`,
)
