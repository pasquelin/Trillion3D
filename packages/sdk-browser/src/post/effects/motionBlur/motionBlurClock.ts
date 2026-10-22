/** The shortest frame the clock divides by, seconds: a frame never takes none. */
const SMALL_NUMBER = 1e-8
/** The share of the frame's length the target of a blur relative to the page's own rate moves to
 *  the length of each new frame. */
const FOLLOW = 0.1
/** The frame a blur relative to the page's own rate starts from, seconds: 60 frames a second. */
const START_FRAME = 1 / 60

/**
 * THE TIME SCALE OF A MOTION BLUR: the length of the frame the streak is relative to, over the
 * length of the frame the motion was measured over, so a page at 60 frames a second blurs a streak
 * the length of a frame of `targetFps`, whatever its rate. The motion is the image's since the one
 * drawn before it: the frame is the time between the two (`next`, `now` the image's time, ms).
 * - with a `targetFps` the frame is its own, `1 / targetFps`;
 * - with none (0) the frame follows the page's: each new image's length moves it a tenth of the
 *   way, from 60 frames a second, so the streak is smooth where the rate is not;
 * - the first image has no frame before it: it takes the target's own length, a scale of 1.
 */
export function createMotionBlurClock() {
  let target = START_FRAME,
    last = Number.NaN
  return {
    next(now: number, targetFps: number) {
      const measured = Number.isNaN(last) ? undefined : (now - last) / 1000
      last = now
      if (targetFps > 0) target = 1 / targetFps
      const frame = Math.max(measured ?? target, SMALL_NUMBER)
      if (targetFps <= 0) target += (frame - target) * FOLLOW
      return target / frame
    },
  }
}
