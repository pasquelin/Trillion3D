import { EngineError } from '../../../sdk-core/src/contracts/cache.ts'
import {
  channelMask,
  channelWords,
  maskWords,
  resolveCollision,
  type CollisionChannel,
  type CollisionOptions,
} from '../../../sdk-core/src/physics/collisionChannels.ts'
import {
  CAST,
  OVERLAP,
  OVERLAP_HIT,
  OVERLAP_HIT_WORDS,
  OVERLAP_AT,
  OVERLAP_WORDS,
} from '../../../sdk-core/src/physics/layout.ts'
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts'
import { NO_INDEX } from '../../../math/src/constants.ts'
import type { PhysicsSession } from './session/session.ts'

/** The words of the channel an overlap tests in when it names none: the channel, then the masks of what it blocks and overlaps (`OVERLAP_AT`). */
const DEFAULT_OVERLAP_CHANNEL = channelWords(resolveCollision(undefined, 'BlockAll'))

/** A shape to test at a place: a sphere, a box or a capsule (upright, turned by `rotation`). */
export type OverlapShape =
  | { type: 'sphere'; radius: number }
  | { type: 'box'; halfExtents: { x: number; y: number; z: number } }
  | { type: 'capsule'; halfHeight: number; radius: number }

/** What `world.physics.overlap` asks, beyond the shape. */
export interface OverlapOptions {
  /** The shape's centre, world frame. */
  at: { x: number; y: number; z: number }
  /** A unit quaternion `[x, y, z, w]`. @defaultValue [0, 0, 0, 1] */
  rotation?: readonly [number, number, number, number]
  /**
   * The channel the query is in and the answers it gives to channels, as a body has them
   * (`CollisionOptions`): the query meets a body by the lesser of what each answers to the other's
   * channel — both `block`, the body blocks the query; either `overlap`, it overlaps it; either
   * `ignore`, it is not met. A body that takes part in no query is never met.
   * @defaultValue { objectType: 'visibility', responses: every channel blocked }
   */
  channel?: Pick<CollisionOptions, 'objectType' | 'responses'>
  /** Seek the bodies of these object types, whatever they answer: every one met blocks. Takes the
   *  place of `channel`. */
  objectTypes?: readonly (CollisionChannel | number)[]
  /** `multi` lists every body met; `any` stops at the first met; `blocking` at the first that
   *  blocks. @defaultValue 'multi' */
  mode?: 'multi' | 'any' | 'blocking'
  /** A body the query passes through: the asker's own. */
  ignore?: Object3D
}

/** A body a shape met: its object, whether it blocks the query (else it overlaps it), and the glTF
 *  material of the cooked triangle met (`-1` for a body's own shape). */
export interface OverlapHit {
  object: Object3D
  blocking: boolean
  material: number
}

/** What a shape met: the bodies in the order of their engine ids, and whether one blocks. */
export interface OverlapResult {
  hits: OverlapHit[]
  /** Whether any body met blocks the query. */
  blocking: boolean
}

const SHAPE = { sphere: CAST.sphere, box: CAST.box, capsule: CAST.capsule } as const

/**
 * What `shape` meets at a place, asked of the running physics between two steps (`jolt_overlap`):
 * the bodies it overlaps or touches, by the rules two bodies meet by. Reads the last step's
 * bodies; the physics must be on.
 * @example
 * const { hits } = await world.physics.overlap({ type: 'sphere', radius: 2 }, { at: crate.position, channel: { objectType: 'pawn' } })
 */
export async function physicsOverlap(
  session: PhysicsSession | null,
  shape: OverlapShape,
  options: OverlapOptions,
): Promise<OverlapResult> {
  if (!session)
    throw new EngineError('PHYSICS_OFF', 'An overlap query asks the physics: turn it on first.')
  const words = new Uint32Array(OVERLAP_WORDS)
  const floats = new Float32Array(words.buffer)
  const byObject = !!options.objectTypes
  const mode = options.mode ?? 'multi'
  words[OVERLAP_AT.mode] = byObject
    ? mode === 'multi'
      ? OVERLAP.multiByObject
      : OVERLAP.anyByObject
    : OVERLAP[mode]
  words[OVERLAP_AT.shape] = SHAPE[shape.type]
  if (shape.type === 'sphere') floats[OVERLAP_AT.extents] = shape.radius
  else if (shape.type === 'box')
    floats.set([shape.halfExtents.x, shape.halfExtents.y, shape.halfExtents.z], OVERLAP_AT.extents)
  else floats.set([shape.halfHeight, shape.radius], OVERLAP_AT.extents)
  floats.set([options.at.x, options.at.y, options.at.z], OVERLAP_AT.position)
  floats.set(options.rotation ?? [0, 0, 0, 1], OVERLAP_AT.rotation)
  // The query answers like a body of its own: the channel and responses are a body's.
  words.set(
    options.channel
      ? channelWords(resolveCollision(options.channel, 'BlockAll'))
      : DEFAULT_OVERLAP_CHANNEL,
    OVERLAP_AT.channel,
  )
  words.set(
    maskWords(options.objectTypes ? channelMask(options.objectTypes) : 0n),
    OVERLAP_AT.objectTypes,
  )
  const ignored = options.ignore ? session.engineIdOf(options.ignore) : NO_INDEX
  words[OVERLAP_AT.ignored] = ignored < 0 ? NO_INDEX : ignored
  const reply = await session.overlap(words)
  const hits: OverlapHit[] = []
  for (let i = 0; i < reply.length; i += OVERLAP_HIT_WORDS) {
    const object = session.objectOf(reply[i])
    if (object)
      hits.push({
        object,
        blocking: (reply[i + 1] & OVERLAP_HIT.blocking) !== 0,
        material: session.materialOf(reply[i]),
      })
  }
  return { hits, blocking: hits.some((hit) => hit.blocking) }
}
