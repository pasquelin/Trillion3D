import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { DAG_BINDING, dagBindEntries } from '../../../geometry/dag/shader/bindings.ts'
import { worldTableWgsl } from '../../../geometry/dag/worlds/worldTable.ts'
import { PLACEMENT_MOTION_AT_EYE_WGSL } from '../../../geometry/dag/shader/worldPoseWgsl.ts'

/** The layout entry of the poses the previous image drew (`../../../geometry/dag/previousPoses.ts`), at the culling's binding of them in group 0: what a
 *  stage that lists `SCENE_HIT_VELOCITY_WGSL` adds to the cut's tables (`dagReadLayoutEntries`) it traces beside. */
export const sceneHitVelocityEntry = () =>
  dagBindEntries().find(({ binding }) => binding === DAG_BINDING.previous)!

/**
 * HOW FAR THE SURFACE A RAY MET MOVED since the last drawn frame (`stHitVelocity`): the hit's point `at`, from the eye, carried by the motion of the
 * placement it met at the eye `e0`, `e1` (`placementMotionAtEye`: the inverse of the placement's world now, then the world the last drawn frame drew it at,
 * both read in the cut's tables and the previous poses' bound at `DAG_BINDING.previous`, at this image's eye): the point less where it stood. Exactly zero
 * for a placement whose two worlds are the same words, and for one whose world is singular. A rigid move of the placement: a deformation is not in it.
 * It reads the cut's world table (`DAG_READ_TABLES_WGSL`), which the program lists beside it. The two measures differ when a lit image is held: the speed
 * of a probe's surface is measured against the last lit image, this one against the last drawn frame.
 */
export const SCENE_HIT_VELOCITY_WGSL = wgslBlock(
  'SCENE_HIT_VELOCITY_WGSL',
  [
    worldTableWgsl('previous', { group: 0, binding: DAG_BINDING.previous, access: 'read' }),
    PLACEMENT_MOTION_AT_EYE_WGSL,
  ],
  `fn stHitVelocity(placement:u32,at:vec3f,e0:vec4u,e1:vec4u)->vec3f{
 return at-(placementMotionAtEye(placement,e0,e1)*vec4f(at,1.0)).xyz;
}`,
)
