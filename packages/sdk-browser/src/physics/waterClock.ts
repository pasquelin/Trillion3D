import { PHYSICS_STEP } from '../../../sdk-core/src/physics/index.ts';

/**
 * The simulated seconds the worker's waves have run, as the page knows them: the ticks received
 * since the water was set, carried on by the page's clock for one step at most, so a frame drawn
 * between two ticks shows the waves moving. It never runs backwards, and stands still with the
 * simulation (paused, or every body asleep).
 */
export function createWaterClock(clock: { readonly paused: boolean; readonly timeScale: number }) {
  let simulated = 0,
    at = 0,
    shown = 0;
  return {
    /** The water was set: its waves start again at 0 s, as the worker's do. */
    reset(now = performance.now()) {
      simulated = shown = 0;
      at = now;
    },
    /** A tick of `seconds` simulated seconds arrived at `now`. */
    received(seconds: number, now: number) {
      simulated += seconds;
      at = now;
    },
    /** The waves' time for a frame drawn at `now`. */
    time(now = performance.now()) {
      const ahead = clock.paused ? 0 : ((now - at) / 1000) * clock.timeScale;
      return (shown = Math.max(shown, simulated + Math.min(ahead, PHYSICS_STEP)));
    },
  };
}
