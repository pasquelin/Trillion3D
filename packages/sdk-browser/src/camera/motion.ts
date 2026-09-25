import type { EngineCamera } from './engineCamera.ts';

/** Last eye position and way back, kept from frame to frame to derive the eye's velocity (world
 *  units per second) and the rate it turns at (radians per second). */
export type CameraMotion = {
  last?: Float64Array;
  lastBack?: Float64Array;
  lastMs?: number;
  velocity?: Float64Array;
  turn?: number;
};

/**
 * Reads one frame of the camera's motion: the eye's velocity and turn rate since the last read, both
 * zero on the first one and on a camera that did not move. Speed is that of the eye in the world: a
 * rig that carries the camera moves it too. Returns the speed.
 */
export function readCameraMotion(cam: EngineCamera, motion: CameraMotion, now: number) {
  const eye = cam.eye,
    view = cam.view;
  const velocity = (motion.velocity ??= new Float64Array(3));
  velocity.fill(0);
  motion.turn = 0;
  if (motion.last && motion.lastBack && motion.lastMs != null) {
    const dt = Math.max((now - motion.lastMs) / 1000, 1e-4);
    for (let axis = 0; axis < 3; axis++) velocity[axis] = (eye[axis] - motion.last[axis]) / dt;
    // The view's third row is the unit way back: the angle between two of them is the turn.
    const back = motion.lastBack,
      cos = back[0] * view[2] + back[1] * view[6] + back[2] * view[10];
    motion.turn = Math.acos(Math.min(1, Math.max(-1, cos))) / dt;
  }
  (motion.last ??= new Float64Array(3)).set(eye);
  const back = (motion.lastBack ??= new Float64Array(3));
  back[0] = view[2];
  back[1] = view[6];
  back[2] = view[10];
  motion.lastMs = now;
  return Math.hypot(velocity[0], velocity[1], velocity[2]);
}
