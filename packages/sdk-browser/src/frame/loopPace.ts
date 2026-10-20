/**
 * How many of the loop's running intervals a gap between two frames may span and still be a
 * frame of a running loop: a frame shown up to this many refreshes late is still one, whose time
 * the world integrates, a longer gap a pause — a still scene the loop slept through, a hidden
 * tab —, no time the scene lived. A ratio of the loop's own
 * interval, not a duration: a loop that really slowed down is followed by this factor per frame,
 * so only the first frame of a sudden slowdown reads as a pause.
 */
const LATE_FRAMES = 4

/**
 * THE LOOP'S ONE PAUSE RULE, read by the world's frames (`../world/core/worldFrames.ts`) on their
 * own clock and unit: `read(gap)`
 * says whether the gap is a pause (`paused`) and returns the time the frame spans — the gap
 * itself, or after a pause one running interval, the frame after a pause counted as one ordinary
 * frame; `ran(gap)` files the interval the loop last ran, what the next gap is judged against —
 * after a pause the last one times the factor, so a loop that slowed down is a pause once.
 * Before any interval is known no gap is a pause.
 */
export function createLoopPace() {
  let interval = Number.NaN
  const pace = {
    /** Whether the last `read` was a pause. */
    paused: false,
    /** The time a frame `gap` after the last spans, in the gap's unit. */
    read(gap: number) {
      pace.paused = gap > LATE_FRAMES * interval
      return pace.paused ? interval : gap
    },
    /** The loop ran an interval `gap` long. Two frames within one clock tick measure nothing:
     *  a zero interval would make every later gap a pause. */
    ran(gap: number) {
      if (gap > 0) interval = pace.paused ? LATE_FRAMES * interval : gap
    },
  }
  return pace
}
