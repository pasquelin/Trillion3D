import { MAX_CATCH_UP_STEPS, PHYSICS_STEP } from '../../../sdk-core/src/physics/index.ts';

/**
 * The physics worker's clock: the simulated time the page's clock let pass since the last tick is
 * owed in fixed steps, a ceiling of catch-up steps; at rest — no tick due, `resting` — it runs the
 * water's waves on instead, so a world asleep still has moving water and the bodies it wakes meet
 * the waves drawn. Paused, nothing is owed and the waves stand still.
 */
export function createStepClock(water: { rest(seconds: number): void }) {
  let last = 0,
    owed = 0;
  const since = (now: number) => ((now - last) / 1000) * clock.timeScale;
  /** The clock starts again at `now`; at rest, the time since the last tick ran the waves on. */
  const restart = (now: number, resting: boolean) => {
    if (resting && !clock.paused) water.rest(since(now));
    last = now;
  };
  const clock = {
    paused: false,
    timeScale: 1,
    /** Simulated seconds owed and not yet stepped. */
    get owed() {
      return owed;
    },
    /** The simulation starts at `now`: nothing owed before it. */
    start(now: number) {
      last = now;
    },
    /** A tick runs at `now`: the time since the last one is owed. */
    tick(now: number) {
      if (!clock.paused) owed = Math.min(owed + since(now), MAX_CATCH_UP_STEPS * PHYSICS_STEP);
      last = now;
    },
    /** Whether one step is owed; if so, it is taken. */
    step() {
      if (clock.paused || owed < PHYSICS_STEP) return false;
      owed -= PHYSICS_STEP;
      return true;
    },
    /** Milliseconds until the next step is owed. */
    delay: () => Math.max(1, ((PHYSICS_STEP - owed) * 1000) / clock.timeScale),
    /** What the page just sent is owed now: a resting world steps at once, not a frame later. */
    wake(now: number, resting: boolean) {
      if (!resting) return;
      restart(now, true);
      if (!clock.paused) owed = Math.max(owed, PHYSICS_STEP);
    },
    /** The page's clock changes at `now`: the time so far passed at the old rate. */
    set(now: number, resting: boolean, paused: boolean, timeScale: number) {
      restart(now, resting);
      Object.assign(clock, { paused, timeScale });
    },
    /** New water, its waves at 0 s: the rest time of a resting world passed before it, and is
     *  never stepped on it. */
    water(now: number, resting: boolean) {
      if (resting) last = now;
    },
  };
  return clock;
}
