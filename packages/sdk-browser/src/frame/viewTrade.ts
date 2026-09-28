/**
 * Moves `keys` of the live group into `from`'s record, then `to`'s into the live group: the one
 * view switch of both engines (`../webgpu/pages/state/viewSwitch.ts`,
 * `../backend/autonomous/views.ts`). References are traded, nothing is allocated.
 */
export function tradeView<T, K extends keyof T>(
  live: T,
  from: Pick<T, K>,
  to: Pick<T, K>,
  keys: readonly K[],
) {
  for (const key of keys) {
    from[key] = live[key];
    live[key] = to[key];
  }
}

/** Hands the gate's engine camera back to `from` and gives it `to`'s, then tells the gate the view
 *  was replaced, so no view holds on another's image: the camera half of both engines' switch. */
export function tradeCamera<C>(
  gate: { cam: C; viewReplaced(): void },
  from: { cam: C },
  to: { cam: C },
) {
  from.cam = gate.cam;
  gate.cam = to.cam;
  gate.viewReplaced();
}
