import { createChangeGate, createControlBase } from './base.ts';
import { axisOf, trackKeys, trackPointers, type KeyAxis } from './input.ts';
import { controlPose } from './pose.ts';
import { moveLocal } from './math.ts';
import {
  multiplyQuaternion,
  normalizeQuaternion,
  localTurnQuaternion,
} from '../../../../sdk-core/src/math/matrix/quaternion.ts';
import type { ControlCamera, SteeredCameraControls } from './types.ts';

/**
 * FLIGHT, six degrees of freedom: the camera keeps no up axis and no pivot. Keys translate
 * along its own axes and turn it about them, roll included; a drag looks around. Nothing is
 * integrated until the host calls `update(delta)` with the seconds elapsed, and `update`
 * returns — and emits — only when a key is held or a drag is pending, so a released stick
 * leaves the scene still.
 *
 * KEYS, by `KeyboardEvent.code`: W/S forward and back, A/D left and right, R/F up and down,
 * arrows pitch and yaw, Q/E roll. `dragToLook` (the default) looks while a pointer is held;
 * set false and the pointer looks as soon as it moves over the surface.
 */
export interface FlyCameraControls extends SteeredCameraControls {
  /** Radians per second at full deflection, for pitch, yaw and roll alike. */
  rollSpeed: number;
  /** Whether dragging turns the view. */
  dragToLook: boolean;
}

const PITCH: KeyAxis = [['ArrowUp'], ['ArrowDown']],
  YAW: KeyAxis = [['ArrowLeft'], ['ArrowRight']],
  ROLL: KeyAxis = [['KeyQ'], ['KeyE']],
  STRAFE: KeyAxis = [['KeyD'], ['KeyA']],
  RISE: KeyAxis = [['KeyR'], ['KeyF']],
  ADVANCE: KeyAxis = [['KeyW'], ['KeyS']];

export function createFlyCameraControls(
  camera: ControlCamera,
  surface: HTMLElement,
): FlyCameraControls {
  const pose = controlPose(camera),
    base = createControlBase();
  const position = new Float64Array(3),
    orientation = new Float64Array(4),
    turn = new Float64Array(4),
    moved = new Float64Array(7);
  const gate = createChangeGate(base, 7);
  let lookPitch = 0,
    lookYaw = 0,
    held = false;
  const height = () => surface.clientHeight || 1;
  const look = (dx: number, dy: number) => {
    lookYaw -= (Math.PI * dx) / height();
    lookPitch -= (Math.PI * dy) / height();
  };
  const api: FlyCameraControls = {
    ...base.api,
    object: pose.object,
    movementSpeed: 1,
    rollSpeed: 0.4,
    dragToLook: true,
    update(delta = 0) {
      const dt = delta > 0 ? delta : 0;
      pose.readPosition(position);
      pose.readOrientation(orientation);
      const pitch = lookPitch + axisOf(keys, ...PITCH) * api.rollSpeed * dt,
        yaw = lookYaw + axisOf(keys, ...YAW) * api.rollSpeed * dt,
        roll = axisOf(keys, ...ROLL) * api.rollSpeed * dt;
      lookPitch = lookYaw = 0;
      if (pitch || yaw || roll)
        normalizeQuaternion(
          multiplyQuaternion(orientation, orientation, localTurnQuaternion(turn, pitch, yaw, roll)),
        );
      const step = api.movementSpeed * dt;
      moveLocal(
        position,
        orientation,
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
  const keys = trackKeys(surface, base, () => base.emit());
  trackPointers(surface, base, {
    down: () => (held = true),
    up: () => (held = false),
    drag: (dx, dy) => {
      if (!api.dragToLook) return;
      look(dx, dy);
      base.emit();
    },
  });
  // `dragToLook = false`: the pointer steers by hovering, which is why this listener is its
  // own and not the tracker's — the tracker only ever reports a pointer that is down.
  base.listen<PointerEvent>(surface, 'pointermove', (event) => {
    if (api.dragToLook || held) return;
    look(event.movementX, event.movementY);
    base.emit();
  });
  return api;
}
