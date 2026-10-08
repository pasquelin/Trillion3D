/**
 * Moves `keys` of the live group into `from`'s record, then `to`'s into the live group: the one
 * view switch of the engine (`../webgpu/pages/state/viewSwitch.ts`). References are traded,
 * nothing is allocated.
 */
export function tradeView<T, K extends keyof T>(
  live: T,
  from: Pick<T, K>,
  to: Pick<T, K>,
  keys: readonly K[],
) {
  for (const key of keys) {
    from[key] = live[key]
    live[key] = to[key]
  }
}

/** Hands the gate's engine camera back to `from` and gives it `to`'s: the camera half of the
 *  engine's switch. The engine then hands the gate the view's own hold (`gateCore.ts`). */
export function tradeCamera<C>(gate: { cam: C }, from: { cam: C }, to: { cam: C }) {
  from.cam = gate.cam
  gate.cam = to.cam
}

/** Whether the drawn view is a capture, not the main view: the engine then ranks its cut first
 *  under the one budget, so it keeps the detail pages it kept alone, while a persistent view and
 *  the main one rank the union (`../webgpu/cut/publication.ts`). */
export const captureDrawn = (
  views: { active: object; main: object },
  capture: { capturing: boolean },
) => views.active !== views.main && capture.capturing
