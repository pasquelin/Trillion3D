import { PHYSICS_STEP } from '../../../sdk-core/src/physics/index.ts';

/** Fixed steps of one measure: a simulated second, whose mean outlasts a single step's spread. */
const WINDOW = Math.round(1 / PHYSICS_STEP);
/** Measures a count is kept after a probe away from it was slower, before the next probe.
 *  Declared, not derived: half a minute of simulation, it only spaces the probes out. */
const HOLD = 30;

/**
 * The threads a step splits its work over (`jolt_concurrency`), following the steps' cost
 * (`stepMs`): after every measure, one thread fewer (or more) is tried; it is kept when its mean
 * step is shorter (one fewer: not longer), else the count goes back and holds. Threads that only
 * contend are left idle. Jolt computes the same step on any count: the image never changes.
 */
export function createThreadTuner(threads: number) {
  let count = threads,
    direction = -1,
    hold = 0,
    steps = 0,
    sum = 0,
    probe: { from: number; mean: number } | null = null;
  return {
    /** Adds a fixed step's milliseconds; returns the count the next steps take. */
    step(ms: number) {
      sum += ms;
      if (++steps < WINDOW) return count;
      const mean = sum / steps;
      steps = sum = 0;
      if (probe && (count < probe.from ? mean > probe.mean : mean >= probe.mean)) {
        [count, direction, hold, probe] = [probe.from, -direction, HOLD, null];
        return count;
      }
      probe = null;
      if (hold > 0) hold--;
      else {
        if (count + direction < 1 || count + direction > threads) direction = -direction;
        const next = count + direction;
        if (next >= 1 && next <= threads) [probe, count] = [{ from: count, mean }, next];
      }
      return count;
    },
  };
}
