/**
 * A pass run again for as long as it is asked, one pass at a time: a request made while a pass
 * runs is taken by the next one, and a burst of requests is one pass. `running` is the loop in
 * flight, `null` once it has ended.
 *
 * Every pass is awaited, even one that returns at once: the loop therefore always outlives the
 * call that started it, and `running` is cleared by the loop itself, never before the caller has
 * stored it. A pass that settled without awaiting used to end the loop inside `request`, whose
 * `??=` then stored a finished loop that no later request could restart (#336).
 */
export function createRequestLoop(pass: () => Promise<void> | void) {
  let wanted = false,
    running: Promise<void> | null = null;
  const run = async () => {
    try {
      while (wanted) {
        wanted = false;
        await pass();
      }
    } finally {
      running = null;
    }
  };
  return {
    /** Asks for one more pass; starts the loop when none runs. */
    request() {
      wanted = true;
      running ??= run();
    },
    /** The loop in flight, or `null`. */
    get running() {
      return running;
    },
  };
}
