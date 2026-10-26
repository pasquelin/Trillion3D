import { HALF_PI, PI } from '../../../../math/src/constants.ts'
import { surfaceHeight, type ControlBase } from './base.ts'
import { trackPointers } from './input.ts'
import type { ControlPose } from './pose.ts'
import { orbitOrientation } from './math.ts'
import { directionYawPitch, POLAR_EPSILON } from '../../../../math/src/vector/spherical.ts'
import { clampCompare } from '../../../../math/src/scalar/reals.ts'
import { rotateByQuaternion } from '../../../../math/src/quaternion/quaternion.ts'
import { sameValues } from '../../../../math/src/matrix/matrixElements.ts'

/**
 * THE HEAD OF A WALKER, pointer locked: the pointer turns it, the horizon stays level — yaw
 * about world up, pitch clamped to `[minPitch, maxPitch]`, never any roll. Shared by every
 * controller that looks through a person's eyes.
 *
 * THE LOCK IS THE HOST'S TO ASK FOR. A browser only grants a pointer lock inside a gesture, so
 * the head asks on `pointerdown` and publishes `lock()`, `unlock()` and `locked()` for a host
 * that would rather choose its own moment; a lock the viewer escapes simply stops the look, and
 * an unlocked drag still turns the head.
 */
export interface HeadSettings {
  /** Radians turned per pixel of pointer motion; `null` (the default) is half a turn per surface
   *  height (`trackLook`). */
  lookSpeed: number | null
  /**
   * Lowest the head looks, in radians below the horizon counted negative (0 is the horizon);
   * by default just short of straight down. Raise it so a walker never looks into its own body.
   */
  minPitch: number
  /** Highest the head looks, in radians above the horizon; by default just short of the zenith. */
  maxPitch: number
}

/** What a controller that looks through a person's eyes publishes: the head and its lock. */
export interface PersonHead extends HeadSettings {
  /** Whether the pointer is locked to the view. */
  locked(): boolean
  /** Locks the pointer to the view. */
  lock(): void
  /** Frees the pointer. */
  unlock(): void
}

/**
 * THE ONE LOOK ACCUMULATOR of every controller the pointer turns: the pixels a drag (`drag()`
 * true) or a move (`move(event)` true) carries are gathered and emitted; `take` hands them out as
 * a yaw and a pitch, radians, at `lookSpeed` — by default half a turn per surface height, whatever
 * the surface's size — and starts again. `down` and `up` hear the pointer as the drag tracker
 * does.
 */
export function trackLook(
  surface: HTMLElement,
  base: ControlBase,
  settings: { lookSpeed: number | null },
  when: { drag(): boolean; move(event: PointerEvent): boolean; down?(): void; up?(): void },
) {
  let x = 0,
    y = 0
  const add = (dx: number, dy: number) => {
    x += dx
    y += dy
    base.emit()
  }
  trackPointers(surface, base, {
    down: when.down,
    up: when.up,
    drag: (dx, dy) => void (when.drag() && add(dx, dy)),
  })
  base.listen<PointerEvent>(surface, 'pointermove', (event) => {
    if (when.move(event)) add(event.movementX, event.movementY)
  })
  return {
    /** Writes the yaw and the pitch gathered since the last call into `out`, radians; clears. */
    take(out: Float64Array) {
      const speed = settings.lookSpeed ?? PI / surfaceHeight(surface)
      out[0] = -x * speed
      out[1] = -y * speed
      x = y = 0
      return out
    },
    /** Drops what was gathered. */
    clear() {
      x = y = 0
    },
  }
}

/** A head's defaults: its own look speed, and a pitch range just short of either pole, where the
 *  yaw would lose its meaning. */
export const HEAD_DEFAULTS = {
  lookSpeed: null as number | null,
  minPitch: POLAR_EPSILON - HALF_PI,
  maxPitch: HALF_PI - POLAR_EPSILON,
}

/** The pointer lock a person's controller publishes, read from its head (`createHead`) once made:
 *  the head reads the controller's settings, so it is made after them. */
export const headLock = (head: () => Pick<PersonHead, 'locked' | 'lock' | 'unlock'>) => ({
  locked: () => head().locked(),
  lock: () => head().lock(),
  unlock: () => head().unlock(),
})

/** The head's two angles, and how a look turns them into an orientation. */
function createHeadAngles(pose: ControlPose, settings: HeadSettings) {
  const read = new Float64Array(4),
    written = new Float64Array(4),
    forward = new Float64Array(3),
    turned = new Float64Array(2),
    angles = new Float64Array(3)
  let pitch = 0,
    yaw = 0
  return {
    // The head keeps its own two angles, but a host that re-poses the camera must be obeyed:
    // an orientation that is not the one last written is read back into yaw and pitch.
    sample() {
      pose.readOrientation(read)
      if (sameValues(read, written)) return
      rotateByQuaternion(forward, read, 0, 0, -1)
      // The elevation of the forward axis, by its height over its horizontal length: blind to the
      // length a quaternion off unit length gives it, and as well conditioned at the poles as at the
      // horizon, where the arc sine of the height alone loses half its digits.
      directionYawPitch(turned, forward[0], forward[1], forward[2])
      yaw = turned[0]
      pitch = turned[1]
    },
    /** Applies the `looked` pitch and yaw and writes the head's orientation into `orientation`;
     *  returns the yaw. */
    turn(looked: Float64Array, orientation: Float64Array) {
      yaw += looked[0]
      pitch = clampCompare(pitch + looked[1], settings.minPitch, settings.maxPitch)
      angles[1] = yaw
      angles[2] = HALF_PI + pitch
      orbitOrientation(orientation, angles)
      written.set(orientation)
      return yaw
    },
  }
}

export function createHead(
  pose: ControlPose,
  surface: HTMLElement,
  base: ControlBase,
  settings: HeadSettings,
) {
  const owner = surface.ownerDocument
  const looked = new Float64Array(2)
  const angles = createHeadAngles(pose, settings)
  const head = {
    locked: () => owner.pointerLockElement === surface,
    // A refused lock (asked too soon after Escape, or from a detached surface) is not an error:
    // the next press asks again.
    lock: () => void Promise.resolve(surface.requestPointerLock?.()).catch(() => {}),
    unlock: () => head.locked() && owner.exitPointerLock?.(),
    /**
     * Applies the look gathered since the last call and writes the head's orientation into
     * `orientation`; returns the yaw, in radians from -Z towards -X, that a walk follows.
     */
    turn(orientation: Float64Array) {
      angles.sample()
      look.take(looked)
      return angles.turn(looked, orientation)
    },
  }
  // The first move a browser reports once the lock is granted may carry the cursor's whole jump
  // to the middle of the screen: it is dropped, never turned into a look. A locked pointer
  // reports through `pointermove`, an unlocked one by its drag.
  let fresh = false
  const look = trackLook(surface, base, settings, {
    down: () => head.lock(),
    drag: () => !head.locked(),
    move: () => {
      if (!head.locked()) return false
      if (!fresh) return true
      fresh = false
      return false
    },
  })
  base.listen<Event>(owner, 'pointerlockchange', () => {
    fresh = head.locked()
    base.emit()
  })
  base.undo(() => head.unlock())
  base.onPause(() => {
    head.unlock()
    look.clear()
  })
  return head
}
