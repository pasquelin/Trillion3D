import { wgslBlock, type WgslDecl } from '../../../../../math/src/wgsl/decl.ts'
import { computeTextureEntry } from '../../../gpu/core/computeBindings.ts'
import { DAG_BINDING, dagBindEntries } from '../../../geometry/dag/shader/bindings.ts'
import { worldTableWgsl } from '../../../geometry/dag/worlds/worldTable.ts'
import { PLACEMENT_MOTION_AT_EYE_WGSL } from '../../../geometry/dag/shader/worldPoseWgsl.ts'

/** The layout entry of the poses the previous image drew (`../../../geometry/dag/previousPoses.ts`), at the culling's binding of them in group 0: what a
 *  stage that lists `SCENE_HIT_VELOCITY_WGSL` adds to the cut's tables (`dagReadLayoutEntries`) it traces beside. */
export const sceneHitVelocityEntry = () =>
  dagBindEntries().find(({ binding }) => binding === DAG_BINDING.previous)!

/** `stHitVelocity` over the pose tables `tables` it reads, a program of the name `name`. */
const hitVelocityWgsl = (name: string, tables: WgslDecl[]) =>
  wgslBlock(
    name,
    [...tables, PLACEMENT_MOTION_AT_EYE_WGSL],
    `fn stHitVelocity(placement:u32,at:vec3f,e0:vec4u,e1:vec4u)->vec3f{
 return at-(placementMotionAtEye(placement,e0,e1)*vec4f(at,1.0)).xyz;
}`,
  )

/**
 * HOW FAR THE SURFACE A RAY MET MOVED since the last drawn frame (`stHitVelocity`): the hit's point `at`, from the eye, carried by the motion of the
 * placement it met at the eye `e0`, `e1` (`placementMotionAtEye`: the inverse of the placement's world now, then the world the last drawn frame drew it at,
 * both read in the cut's tables and the previous poses' bound at `DAG_BINDING.previous`, at this image's eye): the point less where it stood. Exactly zero
 * for a placement whose two worlds are the same words, and for one whose world is singular. A rigid move of the placement: a deformation is not in it.
 * It reads the cut's world table (`DAG_READ_TABLES_WGSL`), which the program lists beside it. The two measures differ when a lit image is held: the speed
 * of a probe's surface is measured against the last lit image, this one against the last drawn frame.
 */
export const SCENE_HIT_VELOCITY_WGSL = hitVelocityWgsl('SCENE_HIT_VELOCITY_WGSL', [
  worldTableWgsl('previous', { group: 0, binding: DAG_BINDING.previous, access: 'read' }),
])

/** `stHitVelocity` of a stage that binds the two poses' tables of its own: the cut's worlds at `worlds` and the previous image's at `previous`, both in group 0 (a stage whose group 0 holds
 *  other bindings at the culling's numbers). Its declaration of the worlds replaces `DAG_READ_TABLES_WGSL`'s, which the stage does not list. */
export const sceneHitVelocityAt = (worlds: number, previous: number) =>
  hitVelocityWgsl(`sceneHitVelocityAt(${worlds},${previous})`, [
    worldTableWgsl('worlds', { group: 0, binding: worlds, access: 'read' }),
    worldTableWgsl('previous', { group: 0, binding: previous, access: 'read' }),
  ])

/** The layout entry of a table of the poses (the cut's worlds, the previous image's) at `binding`: the world table's, read as words. */
export const poseTableEntry = (binding: number) => computeTextureEntry(binding, 'uint', '2d-array')
