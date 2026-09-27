import type { EngineCamera } from './engineCamera.ts';

/** Last eye position and way back, kept from frame to frame to derive the eye's velocity (world
 *  units per second) and the rate it turns at (radians per second). `ahead` is the velocity the
 *  view ahead extrapolates (`../gpu/core/aheadView.ts`): the eye's, smoothed. */
export type CameraMotion = {
  last?: Float64Array;
  lastBack?: Float64Array;
  lastMs?: number;
  velocity?: Float64Array;
  turn?: number;
  ahead?: Float64Array;
};

/**
 * Time constant, in milliseconds, of the exponential filter the view ahead reads the velocity
 * through: about six frames at 60 Hz, so one frame's jitter moves the pages asked for ahead by a
 * sixth of it, and a bend of the path is followed within a tenth of a second.
 */
export const AHEAD_SMOOTHING_MS = 100;

/** True for a velocity that moves, at a finite speed: the only kind the filter averages. */
const movesFinitely = (v: Float64Array) =>
  Number.isFinite(v[0] + v[1] + v[2]) && !!(v[0] || v[1] || v[2]);

/**
 * The velocity the view ahead reads: the eye's, filtered exponentially over `AHEAD_SMOOTHING_MS`
 * while it moves. A still eye reads zero, and an eye that starts moving its velocity as it is: a
 * stop leaves no view ahead behind — a still camera cuts as before, bit for bit — and a start
 * waits for no filter.
 */
function smoothAhead(motion: CameraMotion, velocity: Float64Array, elapsedMs: number) {
  const ahead = (motion.ahead ??= new Float64Array(3)),
    keep = Math.exp(-elapsedMs / AHEAD_SMOOTHING_MS);
  // A clock that went back or reads NaN keeps nothing either: the velocity is taken as it is.
  if (!(movesFinitely(velocity) && movesFinitely(ahead) && keep <= 1)) ahead.set(velocity);
  else
    for (let axis = 0; axis < 3; axis++)
      ahead[axis] = velocity[axis] + keep * (ahead[axis] - velocity[axis]);
}

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
    // The view's third row is the unit way back: the angle between two of them is the turn. Read
    // from their cross and dot products, which is exactly zero for the same way back — its unit
    // length is only rounded, so an arc cosine would read a still camera as turning.
    const back = motion.lastBack,
      x = view[2],
      y = view[6],
      z = view[10];
    const sin = Math.hypot(
      back[1] * z - back[2] * y,
      back[2] * x - back[0] * z,
      back[0] * y - back[1] * x,
    );
    motion.turn = Math.atan2(sin, back[0] * x + back[1] * y + back[2] * z) / dt;
  }
  smoothAhead(motion, velocity, now - (motion.lastMs ?? now));
  (motion.last ??= new Float64Array(3)).set(eye);
  const back = (motion.lastBack ??= new Float64Array(3));
  back[0] = view[2];
  back[1] = view[6];
  back[2] = view[10];
  motion.lastMs = now;
  return Math.hypot(velocity[0], velocity[1], velocity[2]);
}

/**
 * Forgets the last read: the next one starts from rest. Its arrays are let go, never written, so a
 * copy of `motion` taken before — a capture's saved view — keeps the pose it held.
 */
export function restartCameraMotion(motion: CameraMotion) {
  motion.last = motion.lastBack = motion.velocity = motion.ahead = undefined;
  motion.lastMs = undefined;
  motion.turn = 0;
}
