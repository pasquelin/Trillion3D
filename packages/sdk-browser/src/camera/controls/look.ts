import type { ControlBase } from './base.ts';
import { trackPointers } from './input.ts';
import type { ControlPose } from './pose.ts';
import { orbitOrientation } from './math.ts';
import { clampNumber, POLAR_EPSILON } from '../../../../sdk-core/src/world/math/spherical.ts';
import { rotateByQuaternion } from '../../../../sdk-core/src/math/matrix/quaternion.ts';

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
  /** Radians turned per pixel of pointer motion; `null` (the default) is 0.002. */
  lookSpeed: number | null;
  /**
   * Lowest the head looks, in radians below the horizon counted negative (0 is the horizon);
   * by default just short of straight down. Raise it so a walker never looks into its own body.
   */
  minPitch: number;
  /** Highest the head looks, in radians above the horizon; by default just short of the zenith. */
  maxPitch: number;
}

/** What a controller that looks through a person's eyes publishes: the head and its lock. */
export interface PersonHead extends HeadSettings {
  /** Whether the pointer is locked to the view. */
  locked(): boolean;
  /** Locks the pointer to the view. */
  lock(): void;
  /** Frees the pointer. */
  unlock(): void;
}

/** Radians a head turns per pixel of pointer motion when its `lookSpeed` is `null`. */
const HEAD_LOOK_SPEED = 0.002;

/** A head's defaults: its own look speed, and a pitch range just short of either pole, where the
 *  yaw would lose its meaning. */
export const HEAD_DEFAULTS = {
  lookSpeed: null as number | null,
  minPitch: POLAR_EPSILON - Math.PI / 2,
  maxPitch: Math.PI / 2 - POLAR_EPSILON,
};

export function createHead(
  pose: ControlPose,
  surface: HTMLElement,
  base: ControlBase,
  settings: HeadSettings,
) {
  const owner = surface.ownerDocument;
  const read = new Float64Array(4),
    written = new Float64Array(4),
    forward = new Float64Array(3),
    angles = new Float64Array(3);
  let pitch = 0,
    yaw = 0,
    lookX = 0,
    lookY = 0;
  // The head keeps its own two angles, but a host that re-poses the camera must be obeyed:
  // an orientation that is not the one last written is read back into yaw and pitch.
  const sample = () => {
    pose.readOrientation(read);
    if (read.every((value, i) => value === written[i])) return;
    rotateByQuaternion(forward, read, 0, 0, -1);
    pitch = Math.asin(clampNumber(forward[1], -1, 1));
    yaw = Math.atan2(-forward[0], -forward[2]);
  };
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
      sample();
      const speed = settings.lookSpeed ?? HEAD_LOOK_SPEED;
      yaw -= lookX * speed;
      pitch = clampNumber(pitch - lookY * speed, settings.minPitch, settings.maxPitch);
      lookX = lookY = 0;
      angles[1] = yaw;
      angles[2] = Math.PI / 2 + pitch;
      orbitOrientation(orientation, angles);
      written.set(orientation);
      return yaw;
    },
  };
  trackPointers(surface, base, {
    down: () => head.lock(),
    drag: (dx, dy) => {
      if (head.locked()) return; // A locked pointer reports through `pointermove` below.
      lookX += dx;
      lookY += dy;
      base.emit();
    },
  });
  // The first move a browser reports once the lock is granted may carry the cursor's whole jump
  // to the middle of the screen: it is dropped, never turned into a look.
  let fresh = false;
  base.listen<PointerEvent>(surface, 'pointermove', (event) => {
    if (!head.locked()) return;
    if (fresh) return void (fresh = false);
    lookX += event.movementX;
    lookY += event.movementY;
    base.emit();
  });
  base.listen<Event>(owner, 'pointerlockchange', () => {
    fresh = head.locked();
    base.emit();
  });
  base.undo(() => head.unlock());
  base.onPause(() => {
    head.unlock();
    lookX = lookY = 0;
  });
  return head;
}
