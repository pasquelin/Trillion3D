import { NO_INDEX } from '../../../math/src/constants.ts'
import {
  COLLISION_CHANNELS,
  objectTypeWords,
} from '../../../sdk-core/src/physics/collisionChannels.ts'
import { CAST_AT, CAST_STOP, CAST_WORDS, HIT_AT } from '../../../sdk-core/src/physics/layout.ts'
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts'
import { hitFloat, ignoredWord, writeCast } from './raycast.ts'
import type { PhysicsSession } from './session/session.ts'

/**
 * The cast of the view origin into the physics (`lighting/shadows/vsm/viewOrigin.ts`), asked by
 * `lighting/shadows/vsm/frame/vsmViewOrigin.ts`, which makes its `onHit` once and hands it to every
 * cast.
 */
export interface ViewOriginCast {
  /** The physics' revision of the world (`PhysicsSession.revision`): a cast asked at one answers
   *  the same until it moves — a body moved, a collision tile streamed in, the session changed. It
   *  never goes back, whatever sessions come and go. */
  revision(): number
  /** How many sessions the cast has served: it moves when the session it goes through changes, one
   *  ended or another begun between two reads. A cast posted at another epoch is never answered. */
  epoch(): number
  /**
   * Casts from `origin` along the unit `direction`, for `reach` metres, through the body of
   * `ignore` — the camera the view is drawn from, if it has one —, against the bodies of every
   * object type, complex collision (a compiled model is met on its cooked triangles). Then
   * `onHit` is given the hit's words, read by `rayHitDistance`; one that meets nothing, and a world
   * whose physics is off, give a miss.
   */
  post(
    origin: ArrayLike<number>,
    direction: ArrayLike<number>,
    reach: number,
    ignore: Object3D | undefined,
    onHit: (hit: Uint32Array) => void,
  ): void
}

/** The words of a cast's hit whose first body is none. */
const MISS = Uint32Array.of(NO_INDEX)

/** The cast query, written whole before each post (the post copies it), its object types fixed:
 *  the bodies of every one stop it, the channel words are not read. */
const query = new Uint32Array(CAST_WORDS)
query.set(objectTypeWords(COLLISION_CHANNELS), CAST_AT.objectTypes)
query[CAST_AT.stop] = CAST_STOP.objectTypes

/** The distance, in metres, to the first body of a hit asked of `reach` metres, or `null` for none. */
export function rayHitDistance(hit: Uint32Array, reach: number) {
  return hit[HIT_AT.body] === NO_INDEX ? null : hitFloat(hit, HIT_AT.fraction) * reach
}

/**
 * The cast of a world: through its running physics `session` (none, no hit). Its revision only
 * grows: each session counts from where the one before left it, so an answer asked of a session
 * that ended is never taken for the new one's.
 */
export function createViewOriginCast(session: () => PhysicsSession | null): ViewOriginCast {
  let held: PhysicsSession | null = null,
    base = 0,
    last = 0,
    epoch = 0
  /** The session now, `held` and `base` moved onto it when it is another. */
  const follow = () => {
    const physics = session()
    if (physics !== held) {
      held = physics
      base = last + 1
      epoch++
    }
    return physics
  }
  return {
    revision() {
      // The session is followed first: `base` is read after it moved.
      const physics = follow()
      return (last = base + (physics?.revision() ?? 0))
    },
    epoch() {
      follow()
      return epoch
    },
    post(origin, direction, reach, ignore, onHit) {
      const physics = follow()
      if (!physics) return onHit(MISS)
      writeCast(query, origin, direction, reach, ignoredWord(physics, ignore))
      physics.castTo(query, onHit)
    },
  }
}
