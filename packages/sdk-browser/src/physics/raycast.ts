import { EngineError } from '../../../sdk-core/src/contracts/cache.ts'
import {
  channelWords,
  objectTypeWords,
  resolveCollision,
  type CollisionChannel,
  type CollisionOptions,
} from '../../../sdk-core/src/physics/collisionChannels.ts'
import {
  CAST,
  CAST_AT,
  CAST_STOP,
  CAST_WORDS,
  HIT_AT,
} from '../../../sdk-core/src/physics/layout.ts'
import type { Intersection } from '../api/query/types.ts'
import type { Ray } from '../../../sdk-core/src/world/math/volumes.ts'
import { Vector3 } from '../../../sdk-core/src/world/math/vector3.ts'
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts'
import type { PhysicsSession } from './session/session.ts'
import { NO_INDEX } from '../../../math/src/constants.ts'

/** A shape to test at a place (`world.physics.overlap`) or to sweep along a ray (`world.raycast(at, { shape })`,
 *  where what it first touches is the hit): a sphere, a box or a capsule (upright, turned by `rotation`). */
export type OverlapShape =
  | { type: 'sphere'; radius: number }
  | { type: 'box'; halfExtents: { x: number; y: number; z: number } }
  | { type: 'capsule'; halfHeight: number; radius: number }

/** `world.raycast` asked of the physics: exact on compiled models — the triangles their cooked
 *  tiles hold —, on every body, and able to sweep a shape. */
export interface PhysicsRaycastOptions {
  /** Answer from the physics. Implied by `shape`. */
  exact?: true
  /** A shape swept along the ray instead of a ray. */
  shape?: OverlapShape
  /** How far the ray reaches, world units. @defaultValue the camera's `far` */
  maxDistance?: number
  /** A body the ray or shape passes through: the asker's own, looking round itself. */
  ignore?: Object3D
  /** The channel the trace is in and the answers it gives to channels, as a body has them
   *  (`PhysicsBodyOptions.collision`): the trace stops at what blocks its channel and passes
   *  through what it overlaps or ignores. @defaultValue the visibility channel, every channel blocked */
  channel?: Pick<CollisionOptions, 'objectType' | 'responses'>
  /** Stop at the bodies of these object types, whatever they answer: every one met blocks. Takes
   *  the place of `channel`; a list that names none is no list. */
  objectTypes?: readonly (CollisionChannel | number)[]
}

/** A physics hit: the object — the compiled model, or the mesh of a body —, and the glTF material
 *  of the cooked triangle hit (its collider's, `physics.json`), `-1` for a body's own shape. */
export type PhysicsIntersection = Intersection & { material: number }

/** Whether `world.raycast` options ask the physics. */
export const asksPhysics = (options: unknown): options is PhysicsRaycastOptions =>
  !!options && typeof options === 'object' && ('exact' in options || 'shape' in options)

/** The word of the body a query passes through: its engine id, `NO_INDEX` for none (no `ignore`, or
 *  a body not simulated). */
export function ignoredWord(session: Pick<PhysicsSession, 'engineIdOf'>, ignore?: Object3D) {
  const id = ignore ? session.engineIdOf(ignore) : NO_INDEX
  return id < 0 ? NO_INDEX : id
}

/** Writes into `floats`, from the word `at`, the sizes of `shape`: a sphere's radius, a box's half
 *  extents, a capsule's half height then radius (`CAST_AT.extents`, `OVERLAP_AT.extents`). */
export function writeShapeExtents(floats: Float32Array, at: number, shape: OverlapShape) {
  if (shape.type === 'sphere') floats[at] = shape.radius
  else if (shape.type === 'box')
    floats.set([shape.halfExtents.x, shape.halfExtents.y, shape.halfExtents.z], at)
  else floats.set([shape.halfHeight, shape.radius], at)
}

/** Writes into the cast query `words` (`CAST_AT` its fields) a ray of `reach` metres from `origin`
 *  along `direction`, or the `shape` swept along it, through the body `ignored`; what stops it
 *  (`CAST_AT.stop`, the channel or the object types) is left to the caller. */
export function writeCast(
  words: Uint32Array,
  origin: ArrayLike<number>,
  direction: ArrayLike<number>,
  reach: number,
  ignored: number,
  shape?: OverlapShape,
) {
  const floats = new Float32Array(words.buffer, words.byteOffset, words.length)
  words[CAST_AT.kind] = shape ? CAST[shape.type] : CAST.ray
  for (let axis = 0; axis < 3; axis++) {
    floats[CAST_AT.origin + axis] = origin[axis]
    floats[CAST_AT.travel + axis] = direction[axis] * reach
  }
  if (shape) writeShapeExtents(floats, CAST_AT.extents, shape)
  words[CAST_AT.ignored] = ignored
}

const hitWord = new Uint32Array(1)
const hitAsFloat = new Float32Array(hitWord.buffer)

/** The float32 at word `at` (`HIT_AT`) of the hit `hit`, a scene query's answer: the one decoder
 *  of a hit's numbers. */
export function hitFloat(hit: Uint32Array, at: number) {
  hitWord[0] = hit[at]
  return hitAsFloat[0]
}

/** The three float32 at `at` (`HIT_AT.point`, `HIT_AT.normal`) of the hit `hit`, as a vector. */
const hitVector = (hit: Uint32Array, at: number) =>
  new Vector3(hitFloat(hit, at), hitFloat(hit, at + 1), hitFloat(hit, at + 2))

/**
 * One query against the simulation, between two steps (`jolt_cast`): the nearest hit along the
 * ray, or `null`. The physics must be on: the tiles it tests are the ones it streams.
 */
export async function physicsRaycast(
  session: PhysicsSession | null,
  ray: Ray,
  options: PhysicsRaycastOptions,
  far: number,
): Promise<PhysicsIntersection | null> {
  if (!session)
    throw new EngineError('PHYSICS_OFF', 'An exact raycast asks the physics: turn it on first.')
  const reach = options.maxDistance ?? far
  const words = new Uint32Array(CAST_WORDS)
  const ignored = ignoredWord(session, options.ignore)
  const { origin, direction } = ray
  writeCast(words, origin.elements, direction.elements, reach, ignored, options.shape)
  // The object types stop it where they name any, else the channel.
  const types = options.objectTypes && objectTypeWords(options.objectTypes)
  if (types && types[0] | types[1]) {
    words.set(types, CAST_AT.objectTypes)
    words[CAST_AT.stop] = CAST_STOP.objectTypes
  } else writeCastChannel(words, options.channel)
  const hit = await session.cast(words)
  const body = hit[HIT_AT.body]
  const object: Object3D | null = body === NO_INDEX ? null : session.objectOf(body)
  if (!object) return null
  return {
    object,
    point: hitVector(hit, HIT_AT.point),
    normal: hitVector(hit, HIT_AT.normal),
    distance: hitFloat(hit, HIT_AT.fraction) * reach,
    face: -1,
    material: session.materialOf(body),
  }
}

/** The words of the channel a trace runs in when it names none: the visibility channel, every
 *  channel blocked. */
const DEFAULT_CAST_CHANNEL = channelWords(
  resolveCollision({ objectType: 'visibility' }, 'BlockAll'),
)

/** Writes into a cast query (`CAST_WORDS`) the channel it traces in and its answers to channels,
 *  from `CAST_AT.channel`: the visibility channel, every channel blocked, unless `channel` says
 *  otherwise. */
function writeCastChannel(
  words: Uint32Array,
  channel?: Pick<CollisionOptions, 'objectType' | 'responses'>,
) {
  const asked = channel
    ? channelWords(
        resolveCollision(
          { ...channel, objectType: channel.objectType ?? 'visibility' },
          'BlockAll',
        ),
      )
    : DEFAULT_CAST_CHANNEL
  words.set(asked, CAST_AT.channel)
}
