import { cpuNow, msSince } from '../diagnostic/stopwatch.ts'

/**
 * The physics worker's step times since its results last went (`physicsWorker.ts`), on the
 * engine's one CPU clock: the fixed steps taken, the time of every step and its buoyancy — the
 * clock the bench reads in Node (`bench/physics/bodies.ts`), not the copy of the results — and
 * the slowest fixed step.
 */
export function createStepTimes() {
  let started = 0
  const times = { steps: 0, stepMs: 0, stepMaxMs: 0 }
  return {
    /** What the next results report: `clear` once they went. */
    times,
    start: () => void (started = cpuNow()),
    /** The step started ends: its ms, counted; a fixed one counted a step, its ms kept when it is
     *  the slowest. */
    stop(fixed: boolean) {
      const ms = msSince(started)
      times.stepMs += ms
      if (fixed) {
        times.steps++
        times.stepMaxMs = Math.max(times.stepMaxMs, ms)
      }
      return ms
    },
    clear: () => void (times.steps = times.stepMs = times.stepMaxMs = 0),
  }
}
