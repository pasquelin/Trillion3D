/**
 * THE AVERAGE VELOCITY OF THE VIEW, the one the cells are sorted along when the settings ask
 * (`worldStreamingUseVelocity`, `source.ts`).
 *
 * Each frame (`update`) the view's position, in metres of the cells' frame, and the time in
 * seconds give the velocity of its last step, averaged into the running one by the weight a step
 * of `dt` seconds has — `dt` hundredths, at most 1: a frame of 10 ms or more is all of it. The
 * average starts from zero for a view seen the first time, and goes back to zero when the view
 * jumped farther than 100 m in one step, when no frame came for more than 5 s, or when the clock
 * did not advance.
 *
 * Cost: O(1) per frame.
 */
import { clamp } from '../../../../math/src/scalar/reals.ts'
import { length3 } from '../../../../math/src/vector/vector.ts'

/** The distance of a step, metres, past which the view is taken to have been moved there. */
const TELEPORT = 100
/** The seconds of a step past which the view is taken to have been idle. */
const IDLE = 5

/** The velocity of a view seen from `update` calls, metres per second. */
export function createSourceVelocity() {
  const average = [0, 0, 0],
    last = [0, 0, 0]
  /** The time of the last step in seconds, none yet while it is not positive. */
  let at = -1
  return {
    /** The view stands at `eye` at `time` seconds: the average velocity now, its array kept. */
    update(eye: ArrayLike<number>, time: number) {
      const fresh = at <= 0,
        dt = fresh ? 1 : time - at
      if (dt <= 0) return average.fill(0)
      at = time
      const mx = eye[0] - last[0],
        my = eye[1] - last[1],
        mz = eye[2] - last[2]
      last[0] = eye[0]
      last[1] = eye[1]
      last[2] = eye[2]
      if (fresh || length3(mx, my, mz) > TELEPORT || dt > IDLE) return average.fill(0)
      const weight = clamp(dt * 100, 0, 1)
      average[0] = average[0] * (1 - weight) + (mx / dt) * weight
      average[1] = average[1] * (1 - weight) + (my / dt) * weight
      average[2] = average[2] * (1 - weight) + (mz / dt) * weight
      return average
    },
  }
}
