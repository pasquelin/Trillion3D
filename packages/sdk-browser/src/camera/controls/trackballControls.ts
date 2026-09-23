import { createPivotControls, trackPivotGestures } from './pivot.ts';
import {
  axisAngleQuaternion,
  multiplyQuaternion,
  normalizeQuaternion,
  rotateByQuaternion,
} from '../../../../sdk-core/src/math/matrix/quaternion.ts';
import type { ControlCamera, PivotCameraControls } from './types.ts';

/**
 * TRACKBALL: the camera rolls around its pivot as if the scene were a ball under the cursor.
 * A drag spins it about the two axes of the SCREEN — the camera's own up and right — so the
 * gesture never stalls at a pole and the horizon is free to tilt, which is the difference
 * from the orbit controller, whose world up is fixed and whose elevation stops short of the
 * poles. Secondary drag or two fingers pan, wheel and pinch dolly, both bounded.
 *
 * `turntable` swaps the horizontal axis for world up: the spin then stays level and no roll
 * accumulates, the vertical drag keeping the free tilt. For a turntable that also clamps its
 * elevation and rebuilds the orientation from its angles, use the orbit controller.
 */
export interface TrackballCameraControls extends PivotCameraControls {
  turntable: boolean;
}

export function createTrackballCameraControls(
  camera: ControlCamera,
  surface: HTMLElement,
): TrackballCameraControls {
  const core = createPivotControls(camera, surface);
  const turn = new Float64Array(4),
    axis = new Float64Array(3);
  /** Turns the camera and its offset about a WORLD axis through the pivot. */
  const spin = (angle: number) => {
    if (!angle) return;
    axisAngleQuaternion(turn, axis, angle);
    normalizeQuaternion(multiplyQuaternion(core.orientation, turn, core.orientation));
    rotateByQuaternion(core.offset, turn, core.offset[0], core.offset[1], core.offset[2]);
  };
  /** The same, about one of the camera's own axes, which is what a screen drag names. */
  const spinLocal = (x: number, y: number, z: number, angle: number) => {
    rotateByQuaternion(axis, core.orientation, x, y, z);
    spin(angle);
  };
  const rotate = (dx: number, dy: number) => {
    core.sample();
    const speed = (2 * Math.PI * api.rotateSpeed) / core.height();
    if (api.turntable) {
      axis.set([0, 1, 0]);
      spin(-dx * speed);
    } else spinLocal(0, 1, 0, -dx * speed);
    spinLocal(1, 0, 0, -dy * speed);
    core.apply();
  };
  const api = Object.assign(core.api, { turntable: false });
  trackPivotGestures(
    surface,
    core.base,
    (dx, dy, button, event) =>
      button === 0 && !event.shiftKey ? rotate(dx, dy) : core.panBy(dx, dy),
    core.panBy,
    core.dolly,
  );
  return api;
}
