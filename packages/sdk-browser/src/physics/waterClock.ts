import { PHYSICS_STEP } from '../../../sdk-core/src/physics/index.ts';

/**
 * The simulated seconds the worker's waves have run, as the page knows them: the water clock of
 * the last tick received, carried on by the page's clock. While bodies are awake it runs one step
 * ahead at most, so a frame drawn between two ticks shows the waves moving without passing the
 * worker; with every body asleep the worker sends no tick and its waves run on (`water.ts`), so
 * the page's clock runs on freely too. It never runs backwards, and stands still when paused.
 */
export function createWaterClock(clock: { readonly paused: boolean; readonly timeScale: number }) {
  let base = 0,
    at = 0,
    resting = true,
    shown = 0;
  const time = (now: number) => {
    const ahead = clock.paused ? 0 : ((now - at) / 1000) * clock.timeScale;
    return (shown = Math.max(shown, base + (resting ? ahead : Math.min(ahead, PHYSICS_STEP))));
  };
  return {
    /** The water was set: its waves start again at 0 s, as the worker's do. */
    reset(now = performance.now()) {
      base = shown = 0;
      at = now;
      resting = true;
    },
    /** A tick arrived at `now`: the water's clock after it, and the bodies it left awake. */
    received(water: number, active: number, now: number) {
      base = water;
      at = now;
      resting = active === 0;
    },
    /** Called before the pause or the time scale changes: the time so far is kept, at the old rate. */
    retime(now = performance.now()) {
      base = time(now);
      at = now;
    },
    /** The waves' time for a frame drawn at `now`. */
    time: (now = performance.now()) => time(now),
  };
}
