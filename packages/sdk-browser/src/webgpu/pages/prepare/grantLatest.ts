import type { Granted, Made } from '../../residency/poolGrants.ts';

/**
 * The pool prepare grants, its budget read again once the device has answered: a budget recorded
 * meanwhile is the later word, granted in turn. Each budget is drawn once (`draw`), and what it
 * draws is granted (`grant`). As mid-session, a later budget refused even at its floor keeps the
 * pool held, one drawing it (`same`) allocates nothing, and a grant that throws releases it.
 * `undefined` when the first budget is refused at its floor.
 */
export async function grantedLatest<P, D, R extends Made>(options: {
  budget: () => number;
  draw: (budgetBytes: number) => D & { pool: P };
  same: (drawn: P, held: P) => boolean;
  grant: (drawn: D) => Promise<Granted<P, R> | undefined>;
  stopped: () => boolean;
}): Promise<Granted<P, R> | undefined> {
  const { budget, draw, same, grant, stopped } = options;
  let held: Granted<P, R> | undefined, granted: Granted<P, R> | undefined, asked: number;
  try {
    do {
      asked = budget();
      const drawn = draw(asked);
      if (held && same(drawn.pool, held.pool)) {
        held.pool = drawn.pool;
        continue;
      }
      granted = await grant(drawn);
      if (granted) {
        held?.made.destroy();
        held = granted;
      }
    } while (granted && budget() !== asked && !stopped());
  } catch (error) {
    held?.made.destroy();
    throw error;
  }
  return held;
}
