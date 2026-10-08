import { lerp } from '../../../math/src/scalar/reals.ts'

/**
 * The page reads' round trip: the time from a request until the page's bytes have landed,
 * smoothed with a gain of an eighth, so one slow answer moves it by an eighth of its lateness.
 * The first measure is taken as it is; zero until there is one. A measure that is not a finite
 * duration is not one.
 *
 * The gain, declared: stands for how many reads the estimate remembers, about eight; a measure
 * weighs `(7/8)^n` after `n` later reads, half of it gone after 5.2. Sensitivity: the view ahead
 * adds the estimate to its horizon (`prefetchHorizonMs`, `../engine/common.ts`), so one read `L`
 * milliseconds late lengthens it by `L / 8`, and a lasting change of the network is followed to
 * 95 % within 23 reads (`ln 0.05 / ln (7/8)` = 22.4). A larger gain follows a change sooner and
 * jumps at every slow answer; a smaller one does the reverse.
 */
export function createRoundTrip() {
  let ms: number | undefined
  return {
    ms: () => ms ?? 0,
    note(sample: number) {
      if (sample >= 0 && sample < Infinity) ms = ms === undefined ? sample : lerp(ms, sample, 0.125)
    },
  }
}
