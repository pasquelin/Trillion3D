import type { Granted } from '../../residency/poolGrants.ts';

/**
 * The pool prepare grants, its budget read again once the device has answered: a budget recorded
 * meanwhile is the later word, granted in turn. As mid-session, a later budget refused even at its
 * floor keeps the pool held, one drawing it (`same`) allocates nothing, and a grant that throws
 * releases it. `undefined` when the first budget is refused at its floor.
 */
export async function grantedLatest<P, R extends { destroy(): void }>(options: {
  budget: () => number;
  draw: (budgetBytes: number) => P;
  same: (drawn: P, held: P) => boolean;
  grant: (budgetBytes: number) => Promise<Granted<P, R> | undefined>;
  stopped: () => boolean;
}): Promise<Granted<P, R> | undefined> {
  const { budget, draw, same, grant, stopped } = options;
  let held: Granted<P, R> | undefined, granted: Granted<P, R> | undefined, asked: number;
  do {
    asked = budget();
    try {
      if (held) {
        const drawn = draw(asked);
        if (same(drawn, held.pool)) {
          held.pool = drawn;
          continue;
        }
      }
      granted = await grant(asked);
    } catch (error) {
      held?.made.destroy();
      throw error;
    }
    if (granted) {
      held?.made.destroy();
      held = granted;
    }
  } while (granted && budget() !== asked && !stopped());
  return held;
}
