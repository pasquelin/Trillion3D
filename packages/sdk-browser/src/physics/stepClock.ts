import { MAX_CATCH_UP_STEPS, PHYSICS_STEP } from '../../../sdk-core/src/physics/index.ts';
import { addressParam, heldOnce } from '../host/addressFlag.ts';

/** `trillion3dPhysicsHz=<n>`: a temporary switch for a measure, the fixed step `1/n` s rather than
 *  `PHYSICS_STEP`; read once, and the page and its worker share the answer (`start.step`). */
const physicsHzAsked = heldOnce(
  addressParam((params) => Number(params.get('trillion3dPhysicsHz') ?? Number.NaN), Number.NaN),
);

/** Seconds of one fixed step: `PHYSICS_STEP`, or the address switch's `1/n` when it names a
 *  rate above 0. */
export function physicsStep() {
  const hz = physicsHzAsked();
  return hz > 0 && hz < Infinity ? 1 / hz : PHYSICS_STEP;
}

/**
 * THE SIMULATION'S CLOCK IS THE FRAMES'. Each frame the world draws, the seconds it advanced
 * (`FrameInfo.delta`: on the display's grid, bounded after a pause), times `timeScale` and none
 * while paused, are owed to the simulation in fixed steps of `step` seconds; one frame owes
 * `MAX_CATCH_UP_STEPS` at most, the time past them dropped (slow motion, never a spiral). The
 * worker is asked for a whole count of steps (`steps`), so the same frames owe the same steps,
 * whatever the worker's speed, short of a `limit` the page sets while it waits on a slower one.
 * A frame whose clock stepped back owes nothing: time never runs backwards.
 *
 * A frame is drawn where the frame before left the clock, one step behind (`drawn`): the worker
 * steps a frame's time once that frame has sent it, so the newest state a frame can hold is the
 * one the frame before asked for, and one step behind it the two states that bracket the drawn
 * time are both there whenever the worker keeps up. The clock moves at the frame's start, before
 * the controller (`worldFrames.ts`): everything the frame draws, the character the controller
 * moves first included, reads that one time.
 */
export function createStepClock(step: number) {
  let steps = 0,
    owed = 0;
  /** The time the frame draws: `owed` seconds past the page's step `step`. */
  const drawn = { step: -1, owed: 0 };
  const clock = {
    paused: false,
    timeScale: 1,
    /** Fixed steps owed since the clock began: the page's step the worker is asked to reach. */
    get steps() {
      return steps;
    },
    drawn: drawn as DrawnTime,
    /** A frame `seconds` after the last: it is drawn where the clock stood, and its simulated time
     *  is owed, the clock never past the page's step `limit`: there it waits, the time beyond
     *  dropped. Returns the steps it adds. */
    frame(seconds: number, limit = Infinity) {
      [drawn.step, drawn.owed] = [steps - 1, owed];
      if (clock.paused || !(seconds > 0) || steps >= limit) return 0;
      owed = Math.min(owed + seconds * clock.timeScale, MAX_CATCH_UP_STEPS * step);
      let taken = 0;
      for (; owed >= step; taken++) owed -= step;
      if (steps + taken >= limit) [taken, owed] = [limit - steps, 0];
      steps += taken;
      return taken;
    },
    /** Simulated seconds from the page's step `from` to the time drawn, 0 before it. */
    since: (from: number) => Math.max(0, (drawn.step - from) * step + drawn.owed),
  };
  return clock;
}

/** The time a frame draws: `owed` simulated seconds past the page's step `step`. */
export type DrawnTime = Readonly<{ step: number; owed: number }>;

/**
 * Where the time `time` stands between two simulated states a step apart, as everything the
 * physics draws reads it (bodies, wheels, soft bodies, the character): 0 at the earlier, never
 * before it, 1 at the newer, the newest the worker delivered, at the page's step `reached`. Past
 * 1, the state at `time` is not delivered yet: while the page waits for it (`waiting`), it is
 * drawn moved on from the newest, a ceiling of catch-up steps at most; else held on it, 1.
 */
export function along(time: DrawnTime, reached: number, step: number, waiting: boolean) {
  const alpha = time.step - reached + 1 + time.owed / step;
  if (alpha < 1) return Math.max(0, alpha);
  return waiting ? Math.min(alpha, 1 + MAX_CATCH_UP_STEPS) : 1;
}
