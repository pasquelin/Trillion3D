import { createChangeGate, createControlBase } from './cameraControlBase.ts';
import { axisOf, trackKeys, trackPointers, type KeyAxis } from './cameraControlInput.ts';
import { controlPose } from './cameraControlPose.ts';
import { moveLocal, orbitOrientation } from './cameraControlMath.ts';
import { clampNumber, POLAR_EPSILON } from '../sdk-core/src/world/math/spherical.ts';
import { rotateByQuaternion } from '../sdk-core/src/math/matrix/quaternion.ts';
import type { ControlCamera, SteeredCameraControls } from './cameraControlTypes.ts';

/**
 * FIRST PERSON, pointer locked: the pointer turns the head, the keys walk. The horizon stays
 * level — yaw about world up, pitch clamped just short of the poles, never any roll — and the
 * walk follows the yaw alone, so looking up does not lift the walker off the floor.
 *
 * THE LOCK IS THE HOST'S TO ASK FOR. A browser only grants a pointer lock inside a gesture, so
 * the controller asks on `pointerdown` and publishes `lock()`, `unlock()` and `locked()` for a
 * host that would rather choose its own moment; a lock the viewer escapes simply stops the
 * look. Keys, by `KeyboardEvent.code`: W/S forward and back, A/D strafe, Space and left shift
 * up and down.
 */
export interface FirstPersonCameraControls extends SteeredCameraControls {
  /** Radians turned per pixel of pointer motion. */
  lookSpeed: number;
  locked(): boolean;
  lock(): void;
  unlock(): void;
}

const STRAFE: KeyAxis = [['KeyD'], ['KeyA']],
  RISE: KeyAxis = [['Space'], ['ShiftLeft']],
  ADVANCE: KeyAxis = [['KeyW'], ['KeyS']];

export function createFirstPersonCameraControls(
  camera: ControlCamera,
  surface: HTMLElement,
): FirstPersonCameraControls {
  const pose = controlPose(camera),
    base = createControlBase();
  const position = new Float64Array(3),
    orientation = new Float64Array(4),
    walk = new Float64Array(4),
    forward = new Float64Array(3),
    angles = new Float64Array(3),
    written = new Float64Array(4),
    moved = new Float64Array(7);
  const gate = createChangeGate(base, 7);
  const owner = surface.ownerDocument;
  let pitch = 0,
    yaw = 0,
    lookX = 0,
    lookY = 0;
  // The head keeps its own two angles, but a host that re-poses the camera must be obeyed:
  // an orientation that is not the one last written is read back into yaw and pitch.
  const sample = () => {
    pose.readOrientation(orientation);
    let same = true;
    for (let i = 0; i < 4; i++) same &&= orientation[i] === written[i];
    if (same) return;
    rotateByQuaternion(forward, orientation, 0, 0, -1);
    pitch = Math.asin(clampNumber(forward[1], -1, 1));
    yaw = Math.atan2(-forward[0], -forward[2]);
  };
  const api: FirstPersonCameraControls = {
    ...base.api,
    dispose() {
      api.unlock();
      base.api.dispose();
    },
    object: pose.object,
    movementSpeed: 1,
    lookSpeed: 0.002,
    locked: () => owner.pointerLockElement === surface,
    lock: () => void surface.requestPointerLock?.(),
    unlock: () => api.locked() && owner.exitPointerLock?.(),
    update(delta = 0) {
      sample();
      const dt = delta > 0 ? delta : 0;
      pose.readPosition(position);
      yaw -= lookX * api.lookSpeed;
      pitch = clampNumber(
        pitch - lookY * api.lookSpeed,
        POLAR_EPSILON - Math.PI / 2,
        Math.PI / 2 - POLAR_EPSILON,
      );
      lookX = lookY = 0;
      angles[1] = yaw;
      angles[2] = Math.PI / 2 + pitch;
      orbitOrientation(orientation, angles);
      angles[2] = Math.PI / 2;
      const step = api.movementSpeed * dt;
      moveLocal(
        position,
        orbitOrientation(walk, angles),
        axisOf(keys, ...STRAFE) * step,
        axisOf(keys, ...RISE) * step,
        axisOf(keys, ...ADVANCE) * step,
      );
      pose.write(position, orientation);
      written.set(orientation);
      moved.set(position);
      moved.set(orientation, 3);
      return gate(moved);
    },
  };
  const keys = trackKeys(surface, base, () => base.emit());
  trackPointers(surface, base, {
    down: () => api.lock(),
    drag: (dx, dy) => {
      if (api.locked()) return; // A locked pointer reports through `pointermove` below.
      lookX += dx;
      lookY += dy;
      base.emit();
    },
  });
  base.listen<PointerEvent>(surface, 'pointermove', (event) => {
    if (!api.locked()) return;
    lookX += event.movementX;
    lookY += event.movementY;
    base.emit();
  });
  base.listen<Event>(owner, 'pointerlockchange', () => base.emit());
  return api;
}
