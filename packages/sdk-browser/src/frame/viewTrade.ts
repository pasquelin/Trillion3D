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

/** Hands the gate's engine camera back to `from` and gives it `to`'s: the camera half of both
 *  engines' switch. Each engine then tells its hold (`gateCore.ts`): WebGPU hands the gate the
 *  view's own hold, WebGL2 breaks its one hold, its attached scene being the other view's. */
export function tradeCamera<C>(gate: { cam: C }, from: { cam: C }, to: { cam: C }) {
  from.cam = gate.cam;
  gate.cam = to.cam;
}

/** Whether the drawn view is a capture, not the main view: both engines then rank its cut first
 *  under the one budget, so it keeps the detail pages it kept alone, while a persistent view and
 *  the main one rank the union (`../webgpu/cut/publication.ts`, `../backend/autonomous/pool.ts`). */
export const captureDrawn = (views: { active: object; main: object }, capturing: boolean) =>
  views.active !== views.main && capturing;
