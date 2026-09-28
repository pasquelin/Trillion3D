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
