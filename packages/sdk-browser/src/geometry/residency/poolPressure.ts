/** The marks an update reads the pool's load against (`streamingOptions.ts`): the low mark within
 *  [10, 100], the high mark within [`minPoolPercent`, 100], the lowest scale within [0.1, 1]. */
export type PoolMarks = {
  readonly minPoolPercent: number
  readonly maxPoolPercent: number
  readonly minScale: number
}

/** Updates running over the pool's high mark before the scale falls: one alone may be a view
 *  uncovered for a moment. */
const OVER_UPDATES = 2
/** Updates running under its low mark before the scale rises again. */
const UNDER_UPDATES = 30
/** What the scale is multiplied by on a fall, quickly, and on a rise, slowly. */
const FALL = 0.97,
  RISE = 1.01

/**
 * THE QUALITY UNDER POOL PRESSURE: a scale of the cut's screen error, 1 while the streaming pool
 * holds what the views ask for — the pixel threshold is divided by it (`../../frame/render/gpuCut.ts`).
 * Once per update, the unique streaming pages requested (`./pageRequests.ts`) are read as a percent
 * of the streaming pool's slots, a streaming page each, against the marks the update read
 * (`PoolMarks`): over `maxPoolPercent`
 * `OVER_UPDATES` updates running, the scale falls by `FALL`; under `minPoolPercent`
 * `UNDER_UPDATES` updates running, it rises by `RISE`. It stays within [`minScale`, 1]: at
 * `minScale`, the pool overcommitted still draws the coarser parents of what does not fit.
 */
export function createPoolPressure() {
  let scale = 1,
    over = 0,
    under = 0
  return {
    /** The scale of the screen error, in [`minScale`, 1]. */
    get scale() {
      return scale
    },
    /** One update's requests: `percent` of the streaming pool's slots, read against `marks`. */
    update(percent: number, marks: PoolMarks) {
      over = percent > marks.maxPoolPercent ? over + 1 : 0
      under = percent < marks.minPoolPercent ? under + 1 : 0
      if (over >= OVER_UPDATES) scale *= FALL
      else if (under >= UNDER_UPDATES) scale *= RISE
      scale = Math.min(1, Math.max(marks.minScale, scale))
    },
  }
}
