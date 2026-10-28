import { invertMatrix4 } from '../../../../math/src/matrix/matrix4Inverse.ts'
import { multiplyMatrix4 } from '../../../../math/src/matrix/matrix4.ts'
import type { ShadowCapsuleBody } from '../../../../sdk-core/src/contracts/capsuleShadowOptions.ts'
import type { Skeleton } from '../../../../sdk-core/src/world/animation/skeleton.ts'
import {
  CAPSULE_SHAPE_FLOATS,
  capsuleAxis,
  restCapsule,
  restSphere,
  writeShadowShapes,
  type RestBody,
} from './shapes.ts'

/**
 * THE SHAPES OF AN OBJECT, from what the scene gives it: the bodies of its `shadowCapsules`, each in the space of a named bone of its
 * skeleton, set in the mesh's bind pose (`restBodiesOf`: a bone's bind pose is the inverse of its inverse bind matrix), and carried each
 * frame by the bone's skinning matrix, the bone's world after the mesh's inverse, times the inverse bind matrix (`skinOf`). A body whose
 * bone the skeleton lacks, or an object with no skeleton, is carried by the object's own matrix alone (bone -1): a rigid object casts too.
 */

/** The bind pose of a bone in the mesh's space: the inverse of its inverse bind matrix. */
const bind = new Float64Array(16)

/** The bodies of `bodies` in the mesh's bind pose, each with the rank of its bone in `skeleton` (-1 for none). */
export function restBodiesOf(
  bodies: readonly ShadowCapsuleBody[],
  skeleton: Skeleton | undefined,
): RestBody[] {
  return bodies.map((body) => {
    const rank = skeleton ? skeleton.bones.findIndex((bone) => bone.name === body.bone) : -1
    const to = rank >= 0 ? invertMatrix4(bind, skeleton!.inverses[rank]) : IDENTITY
    return body.kind === 'sphere'
      ? restSphere(rank, to, body.center, body.radius)
      : restCapsule(rank, to, body.center, body.radius, capsuleAxis(body.rotation), body.length)
  })
}

const IDENTITY = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
const meshInverse = new Float64Array(16)
const joint = new Float64Array(16)

/** The skinning matrix of the bone of rank `bone` for a mesh placed at `meshWorld`: `meshWorld⁻¹ · boneWorld · inverseBind`; none for -1. */
function skinOf(skeleton: Skeleton | undefined, meshWorld: ArrayLike<number>) {
  if (!skeleton) return () => undefined
  invertMatrix4(meshInverse, meshWorld)
  return (bone: number) => {
    if (bone < 0) return undefined
    multiplyMatrix4(
      joint,
      skeleton.bones[bone].matrixWorld.elements as Float64Array,
      skeleton.inverses[bone],
    )
    return multiplyMatrix4(joint, meshInverse, joint)
  }
}

/** An object that may cast capsule shadows. */
export interface CapsuleObject {
  readonly bodies: readonly RestBody[]
  readonly skeleton: Skeleton | undefined
  readonly world: Float64Array
  /** The node the object casts from (the cut's roots name it). */
  readonly node?: object
  readonly direct: boolean
  readonly indirect: boolean
  readonly minVisibility: number
}

/** Writes the world shapes of the objects `objects` for which `wants` holds into `out` (grown by the caller to `shapes * CAPSULE_SHAPE_FLOATS`),
 *  and returns how many shapes it wrote; `ranges` receives each object's first and past-the-last shape, so its fade and its light record can be applied. */
export function writeObjectShapes(
  out: Float32Array,
  objects: readonly CapsuleObject[],
  wants: (object: CapsuleObject) => boolean,
  translation: readonly [number, number, number],
  ranges: number[],
) {
  let count = 0
  ranges.length = 0
  for (const object of objects) {
    if (!wants(object) || !object.bodies.length) continue
    if ((count + object.bodies.length) * CAPSULE_SHAPE_FLOATS > out.length) break
    const written = writeShadowShapes(
      out,
      count * CAPSULE_SHAPE_FLOATS,
      object.bodies,
      skinOf(object.skeleton, object.world),
      object.world,
      translation,
    )
    ranges.push(count, count + written)
    count += written
  }
  return count
}
