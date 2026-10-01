import type { SceneLightStore } from '../light/store.ts';
import { createShadowAdmission } from './admit.ts';
import { DRAW_ALL } from './pool.ts';
import type { ShadowRequestReport } from './requests.ts';
import { checkViewBudget } from './viewBudget.ts';
import { createShadowMirror } from './mirror.ts';
import { createShadowPlanning } from './planState.ts';
import { planShadowView } from './planView.ts';
import { SUN_WINDOW } from './virtual.ts';
/** The frame's shadow work: which virtual pages are drawn. */
export type ShadowPlan = ReturnType<typeof createShadowPlan>;

/** Shared shadow pool and table, with independent camera scheduling for each live view. */
export function createShadowPlan(poolSide: number, layers = 1, sunWindow = SUN_WINDOW) {
  const shared = createShadowPlanning(poolSide, layers, sunWindow),
    { pool, table, sun, records, counts, thresholds, spent, views, slices } = shared;
  let issued = 0;
  const shadowPlan = {
    /** Pages a side of a sun's clipmap a session runs with (`referenceMode.ts`). */
    sunWindow,
    /** The page table: one word per virtual page, and the range each light holds in it. */
    table,
    /** The physical pages of the pool and the virtual page each one holds. */
    pool,
    /** Each sun's clipmap: its frame, depth range, finest level and extents. */
    sun,
    /** The shadow slices, shared for lamps and separate for each sun and view. */
    records,
    /** Visits every live view’s shadow slices and their source lights. */
    eachSlice: slices.each,
    /** The oldest frame whose shadow pages a live view still needs. */
    keptFrom: views.keptFrom,
    /** The request reports read back: what the latest one named, allocated or refused. */
    requests: shared.state.requests,
    /** The GPU's allocation (`mirror.ts`): whether it maps the pages, what the host asks of it. */
    gpu: shared.gpu,
    /** What the last plan did, in pages. */
    counts,
    /** CPU milliseconds the last plan spent reading the request report and admitting pages. */
    spent,
    /** This frame's pages, the coarsest first, light view by light view. */
    admission: shared.admission,
    /** A node has moved: its box stales the pages it covers at the next plan; the boxes the list
     *  still holds apart (`changeRoom`). */
    worldChanged: views.worldChanged,
    /** Boxes the pending change lists can still hold before overflow. */
    changeRoom: views.room,
    /** The same world at another precision: its box waits for the camera to rest. */
    representationChanged: views.representationChanged,
    /** The threshold the light cuts select casters at, and their render origin (`thresholds.ts`). */
    setThreshold: thresholds.set,
    /** The camera rested at the last plan: its view was the one of the plan before. */
    get resting() {
      return shared.state.resting;
    },
    /** True while a representation change waits for the camera to rest. */
    get deferredChanges() {
      return shared.state.changes.deferred() || thresholds.pending;
    },
    /** The frame plans no shadow: the held union enters the list at once. */
    releaseDeferred: () => shared.state.changes.releaseDeferred(),
    /** Turns off per-page invalidation: a moving object stales every page of the lights it
     *  touches. On by default. */
    setPageInvalidation(on: boolean) {
      shared.byPage = on;
    },
    /** Whether a moving object stales only the pages its box covers. */
    get pageInvalidation() {
      return shared.byPage;
    },
    /** The state the next image gets: a report stamped with it naming nothing new, it holds. */
    stamp: shared.stamp,
    /** True once a report proves the current state asks for nothing: the image may hold. */
    settled: (store: SceneLightStore) => shared.state.settledStamp === shared.stamp(store),
    /** A report came back: its GPU listing counts now (`gpu.hear`), the next plan reads the rest. */
    receive(next: ShadowRequestReport) {
      if (!shared.state.report || next.frame > shared.state.report.frame)
        shared.gpu.hear((shared.state.report = shared.state.keep(next)));
    },
    /** Plans a frame: stales what moved, reads the last report, admits every page to draw. */
    plan: planShadowView.bind(undefined, shared),
    /** Pages `[from, to)` were encoded, `from + i` in `modes[i]`; the last batch closes the list. */
    commit(modes?: ArrayLike<number>, from = 0, to = shared.admission.count) {
      for (let i = from; i < to; i++) {
        const page = shared.admission.list[i];
        pool.drew(table, page, modes ? modes[i - from] : DRAW_ALL, records.rangeOf(page));
        thresholds.drew(page);
      }
      if (to >= shared.admission.count) shared.admission.reset();
    },
    /** The list's pages from `from` on were not encoded: stale, pending, first next (`admit.ts`). */
    reissue(from = 0) {
      counts.pendingPages = Math.max(0, shared.admission.count - from);
      shared.admission.reset(from);
    },
    /** Reserves a view in the shared shadow budget, or refuses it before drawing. */
    registerView(key: unknown, store: SceneLightStore) {
      if (views.states.has(key)) return;
      checkViewBudget(store, views.states.size + 1, pool.pages);
      views.get(key);
    },
    /** Selects the camera-dependent shadow state of a stable view key. */
    useView(key: unknown) {
      shared.viewKey = key;
      shared.state = views.get(key);
      shadowPlan.requests = shared.state.requests;
    },
    /** Releases a view’s sun slices and returns its pages to the shared pool. */
    removeView(key: unknown) {
      slices.remove(key);
      views.remove(key);
      if (shared.viewKey === key) shadowPlan.useView(undefined);
    },
    /** Captures the current view and submission order for a later GPU report. */
    receiver() {
      const target = shared.state,
        submission = ++issued,
        generation = records.drops;
      return (next: ShadowRequestReport) => {
        if (!target.alive || generation !== records.drops || submission <= target.received) return;
        next.generation = generation;
        target.received = next.submission = submission;
        shared.gpu.hear((target.report = target.keep(next)));
      };
    },
    /** Starts over. */
    reset() {
      for (const part of [
        records,
        table,
        pool,
        thresholds,
        views,
        slices,
        counts,
        shared.admission,
      ])
        part.reset();
      shared.gpu.set(false, 0);
    },
    /** The pool at the size the device granted (`webgpu/shadow/poolSize.ts`), once, before any
     *  page is mapped: it is never resized after, so no page ever changes place (#831). */
    size(side: number, poolLayers: number) {
      pool.resize(side, poolLayers);
      thresholds.sized();
      views.resize();
      shadowPlan.requests = shared.state.requests;
      shadowPlan.gpu = shared.gpu = createShadowMirror(table, pool, records, sun, shared.gpu);
      shadowPlan.admission = shared.admission = createShadowAdmission(pool.pages);
    },
  };
  return shadowPlan;
}
