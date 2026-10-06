import type { EngineCamera } from './engineCamera.ts'
import { hypot3 } from '../../../sdk-core/src/math/primitives/hypot.ts'
import { AHEAD_SMOOTHING_MS } from './motionSmoothing.ts'

/** Last eye position and way back, kept from frame to frame to derive the eye's velocity (world
 *  units per second) and the rate it turns at (radians per second). `ahead` is the velocity the
 *  view ahead extrapolates (`../gpu/core/aheadView.ts`): the eye's, smoothed. */
export type CameraMotion = {
  last?: Float64Array
  lastBack?: Float64Array
  lastMs?: number
  velocity?: Float64Array
  turn?: number
  /** The unit axis the way back turned about, from the last read to this one (`turn`'s). */
  axis?: Float64Array
  ahead?: Float64Array
  /** How long, in milliseconds, the eye has moved, and the view turned, with no cut (`steady`): the
   *  view ahead extrapolates each no longer than that (`../gpu/core/aheadView.ts`). Absent, no bound. */
  steadyMs?: number
  turnSteadyMs?: number
  /** How far ahead, in milliseconds, the view ahead looks: the pages' round trip past the published
   *  horizon (`prefetchHorizonMs`), set by the cut each frame; absent, the published horizon. */
  horizonMs?: number
}

/** True for a velocity that moves, at a finite speed: the only kind the filter averages. */
const movesFinitely = (v: Float64Array) =>
  Number.isFinite(v[0] + v[1] + v[2]) && !!(v[0] || v[1] || v[2])

/**
 * The velocity the view ahead reads: the eye's, filtered exponentially over `AHEAD_SMOOTHING_MS`
 * while it moves. A still eye reads zero, and an eye that starts moving — or cuts — its velocity as
 * it is: a stop leaves no view ahead behind — a still camera cuts as before, bit for bit — and a
 * start waits for no filter.
 */
function smoothAhead(
  motion: CameraMotion,
  velocity: Float64Array,
  elapsedMs: number,
  cut: boolean,
) {
  const ahead = (motion.ahead ??= new Float64Array(3)),
    keep = Math.exp(-elapsedMs / AHEAD_SMOOTHING_MS)
  // A clock that went back or reads NaN keeps nothing either: the velocity is taken as it is.
  if (cut || !(movesFinitely(velocity) && movesFinitely(ahead) && keep <= 1)) ahead.set(velocity)
  else
    for (let axis = 0; axis < 3; axis++)
      ahead[axis] = velocity[axis] + keep * (ahead[axis] - velocity[axis])
}

/**
 * True when a rate — a speed, a turn rate — CONTINUES from `before` to `now`: it changed by `change`,
 * no more than the lesser of the two, so it at most doubled or halved, or bent by at most 60°. Else
 * it is a CUT — a start, a stop, a jump such as a teleport, a reversal —: nothing before it says
 * where the camera goes. Read from the camera's motion alone: nothing is tuned.
 */
const continues = (change: number, before: number, now: number) => change <= Math.min(before, now)
/** How long a motion has held after a frame of `stepMs`: nothing once still, the frame alone after
 *  a cut — so a one-frame jump sends the view ahead no further than the jump —, the frame more
 *  otherwise. */
const steady = (held: number | undefined, moves: boolean, holds: boolean, stepMs: number) =>
  !moves ? 0 : holds ? (held ?? 0) + stepMs : stepMs
/** The rest a first read compares with, and the last read's turn as a vector (axis × rate). */
const REST = new Float64Array(3),
  spin = new Float64Array(3)

/**
 * Reads one frame of the camera's motion: the eye's velocity and turn rate since the last read, both
 * zero on the first one and on a camera that did not move, and how long each has held. Speed
 * is that of the eye in the world: a rig that carries the camera moves it too. Returns the speed.
 */
export function readCameraMotion(cam: EngineCamera, motion: CameraMotion, now: number) {
  const eye = cam.eye,
    view = cam.view,
    was = motion.turn ?? 0
  const velocity = (motion.velocity ??= new Float64Array(3)),
    axis = (motion.axis ??= new Float64Array(3))
  // The turn, like the velocity, is a vector: a reversal at the same rate is a cut too.
  for (let k = 0; k < 3; k++) spin[k] = axis[k] * was
  velocity.fill(0)
  axis.fill(0)
  motion.turn = 0
  if (motion.last && motion.lastBack && motion.lastMs != null) {
    const dt = Math.max((now - motion.lastMs) / 1000, 1e-4)
    for (let k = 0; k < 3; k++) velocity[k] = (eye[k] - motion.last[k]) / dt
    // The view's third row is the unit way back: the angle between two of them is the turn, about
    // their cross product. Read from the cross and dot products, which is exactly zero for the same
    // way back — its unit length is only rounded, so an arc cosine would read a still camera as
    // turning.
    const back = motion.lastBack,
      x = view[2],
      y = view[6],
      z = view[10]
    axis[0] = back[1] * z - back[2] * y
    axis[1] = back[2] * x - back[0] * z
    axis[2] = back[0] * y - back[1] * x
    const sin = hypot3(axis[0], axis[1], axis[2])
    motion.turn = Math.atan2(sin, back[0] * x + back[1] * y + back[2] * z) / dt
    for (let k = 0; k < 3 && sin > 0; k++) axis[k] /= sin
  }
  const elapsed = now - (motion.lastMs ?? now),
    step = elapsed > 0 ? elapsed : 0,
    a = motion.ahead ?? REST,
    change = hypot3(velocity[0] - a[0], velocity[1] - a[1], velocity[2] - a[2]),
    moving = continues(
      change,
      hypot3(a[0], a[1], a[2]),
      hypot3(velocity[0], velocity[1], velocity[2]),
    ),
    turn = motion.turn,
    turning = continues(
      hypot3(axis[0] * turn - spin[0], axis[1] * turn - spin[1], axis[2] * turn - spin[2]),
      was,
      turn,
    )
  motion.steadyMs = steady(motion.steadyMs, movesFinitely(velocity), moving, step)
  motion.turnSteadyMs = steady(motion.turnSteadyMs, motion.turn > 0, turning, step)
  // The filter restarts on a cut, as on a start.
  smoothAhead(motion, velocity, elapsed, !moving)
  ;(motion.last ??= new Float64Array(3)).set(eye)
  const back = (motion.lastBack ??= new Float64Array(3))
  back[0] = view[2]
  back[1] = view[6]
  back[2] = view[10]
  motion.lastMs = now
  return hypot3(velocity[0], velocity[1], velocity[2])
}
