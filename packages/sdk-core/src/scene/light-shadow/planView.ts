import type { ShadowViewpoint } from '../light/contracts.ts';
import type { SceneLightStore } from '../light/store.ts';
import { STALE_BY } from './counts.ts';
import { planLights } from './planLights.ts';
import { checkViewBudget, protectViewPages } from './viewBudget.ts';
import type { createShadowPlanning } from './planState.ts';

/** Plan the selected view against the shared atlas without consuming another view's changes. */
export function planShadowView(
  shared: ReturnType<typeof createShadowPlanning>,
  store: SceneLightStore,
  view: ShadowViewpoint,
  sceneMin: ArrayLike<number>,
  sceneMax: ArrayLike<number>,
  frame: number,
  nowMs: number,
) {
  const {
      pool,
      table,
      sun,
      records,
      counts,
      thresholds,
      posed,
      spent,
      views,
      slices,
      state,
      lightsState,
      gpu,
      admission,
      byPage,
    } = shared,
    { requests } = state;
  if (views.states.size > 1) checkViewBudget(store, views.states.size, pool.pages);
  state.lastFrame = frame;
  counts.beginFrame();
  slices.select(shared.viewKey, store);
  lightsState.invalidate = state.invalidate;
  const changes = state.changes;
  const still = changes.observeView(view),
    quiet = still && !changes.worldMoved();
  state.resting = still;
  state.restFrame = quiet ? (state.restFrame < 0 ? frame : state.restFrame) : -1;
  if (!still) state.views++;
  const held = quiet ? state.restFrame : undefined;
  planLights(lightsState, store, view, sceneMin, sceneMax, frame, nowMs, byPage);
  slices.remember(store);
  if (views.states.size > 1)
    protectViewPages(pool, sun, slices.active, store, view, frame, shared.budgetBox);
  gpu.noteFrame(frame, !quiet);
  changes.settled();
  if (still) counts.staled(STALE_BY.threshold, thresholds.restale(nowMs, frame));
  if (quiet) counts.staled(STALE_BY.range, sun.ranges.restale(pool, nowMs, frame));
  const readStart = performance.now();
  if (state.report) {
    const before = shared.stamp(store),
      read = state.report;
    state.report = null;
    if (!gpu.on || gpu.follow(read, nowMs, frame)) {
      requests.consume(read, nowMs, frame, held ?? frame);
      if (read.stamp === before && requests.complete) state.settledStamp = shared.stamp(store);
    }
  }
  if (gpu.on && views.states.size > 1)
    protectViewPages(pool, sun, slices.active, store, view, frame, shared.budgetBox);
  const admitStart = performance.now();
  spent.requestsMs = admitStart - readStart;
  gpu.asks.count = 0;
  requests.floors(posed, view, nowMs, frame, held, gpu.on ? gpu.asks : undefined, slices.active);
  const count = admission.run(pool, table, requests.latest, frame, records.isFloor, slices.active);
  for (let i = 0; i < count; i++) {
    const slice = pool.slice[admission.list[i]];
    counts.drewLight(slice, records.kind[slice], frame);
  }
  counts.endFrame(pool, records, requests.latest, nowMs, frame);
  spent.admissionMs = performance.now() - admitStart;
  return count;
}
