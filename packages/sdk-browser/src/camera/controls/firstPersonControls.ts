import { createChangeGate, createControlBase } from './base.ts';
import { axisOf, trackKeys, type KeyAxis } from './input.ts';
import { controlPose } from './pose.ts';
import { moveLocal, orbitOrientation } from './math.ts';
import { createHead, HEAD_DEFAULTS, type PersonHead } from './look.ts';
import type { ControlCamera, SteeredCameraControls } from './types.ts';

/**
 * FIRST PERSON, pointer locked: the pointer turns the head, the keys walk. The horizon stays
 * level — yaw about world up, pitch clamped to `[minPitch, maxPitch]`, never any roll — and the
 * walk follows the yaw alone, so looking up does not lift the walker off the floor.
 *
 * THE LOCK IS THE HOST'S TO ASK FOR. A browser only grants a pointer lock inside a gesture, so
 * the controller asks on `pointerdown` and publishes `lock()`, `unlock()` and `locked()` for a
 * host that would rather choose its own moment; a lock the viewer escapes simply stops the
 * look. Keys, by `KeyboardEvent.code`: W/S forward and back, A/D strafe, Space and left shift
 * up and down.
 */
export interface FirstPersonCameraControls extends SteeredCameraControls, PersonHead {}

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
    angles = new Float64Array(3),
    moved = new Float64Array(7);
  const gate = createChangeGate(base, 7);
  const api: FirstPersonCameraControls = {
    ...base.api,
    object: pose.object,
    movementSpeed: 1,
    ...HEAD_DEFAULTS,
    locked: () => head.locked(),
    lock: () => head.lock(),
    unlock: () => head.unlock(),
    update(delta = 0) {
      const dt = delta > 0 ? delta : 0;
      pose.readPosition(position);
      angles[1] = head.turn(orientation);
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
      moved.set(position);
      moved.set(orientation, 3);
      return gate(moved);
    },
  };
  const head = createHead(pose, surface, base, api);
  const keys = trackKeys(surface, base, () => base.emit(), [STRAFE, RISE, ADVANCE]);
  return api;
}
