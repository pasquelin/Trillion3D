import type { ShadowViewpoint } from '../light/contracts.ts';
import type { SceneLightStore } from '../light/store.ts';
import { createShadowChanges } from './changes.ts';
import { createPageInvalidation } from './invalidate.ts';
import { STALE_BY, createShadowCounts } from './counts.ts';
import { createShadowAdmission } from './admit.ts';
import { createDemandFootprints } from './demandFootprint.ts';
import { planLights } from './planLights.ts';
import { createShadowTable } from './table.ts';
import { DRAW_ALL, createShadowPool } from './pool.ts';
import { resizeShadowPool } from './poolResize.ts';
import { createSunLevels } from './sunLevels.ts';
import { createShadowRecords } from './records.ts';
import { createShadowRequests, type ShadowRequestReport } from './requests.ts';
import { createShadowMirror } from './mirror.ts';
import { createShadowThresholds } from './thresholds.ts';
import { SUN_WINDOW, shadowTableEntries } from './virtual.ts';

/** The frame's shadow work: which virtual pages are drawn. */
export type ShadowPlan = ReturnType<typeof createShadowPlan>;

/**
 * The shadow scheduler of the virtual maps. The shading records the pages it reads; their report, read back frames later, allocates what is
 * missing from the fixed pool. What moved stales the mapped pages it covers. A frame then draws every stale page the image reads, all of them
 * in that frame (`admit.ts`): what holds the cost is the cache — a page is drawn again only when what it holds changed —, and the pool is the
 * only limit. A still scene, whose shading runs no more, asks for nothing and draws nothing. All arrays are allocated once; `plan()` allocates nothing.
 */
export function createShadowPlan(poolSide: number, layers = 1, sunWindow = SUN_WINDOW) {
  const pool = createShadowPool(poolSide, layers, shadowTableEntries(sunWindow)),
    table = createShadowTable(pool.pages, sunWindow),
    sun = createSunLevels(sunWindow),
    records = createShadowRecords(table, pool, sun),
    changes = createShadowChanges(pool.pages),
    counts = createShadowCounts(),
    invalidate = createPageInvalidation(pool, table, sun, changes, counts),
    thresholds = createShadowThresholds(pool),
    posed = new Int32Array(records.taken.length),
    spent = { requestsMs: NaN, admissionMs: NaN },
    lightsState = { records, counts, sun, posed, invalidate };
  const footprints = createDemandFootprints(table, pool);
  let requests = createShadowRequests(table, pool, records, sun),
    gpu = createShadowMirror(table, pool, records, sun),
    admission = createShadowAdmission(pool.pages),
    byPage = true,
    report: ShadowRequestReport | null = null,
    resting = false,
    restFrame = -1, // The frame view and world came to rest at, else −1: the kept cycle (#26)
    views = 0,
    settledStamp = -1;
  const stampOf = (store: SceneLightStore) => table.version + views + store.epoch;
  const shadowPlan = {
    /** Pages a side of a sun's clipmap a session runs with (`referenceMode.ts`). */
    sunWindow,
    /** The page table: one word per virtual page, and the range each light holds in it. */
    table,
    /** The physical pages of the pool and the virtual page each one holds. */
    pool,
    /** Each sun's clipmap: its frame, depth range, finest level and extents. */
    sun,
    /** The shadow slices, one per light that casts a shadow. */
    records,
    /** The request reports read back: what the latest one named, allocated or refused. */
    requests,
    /** The GPU's allocation (`mirror.ts`): whether it maps the pages, what the host asks of it. */
    gpu,
    /** What the last plan did, in pages. */
    counts,
    /** CPU milliseconds the last plan spent reading the request report and admitting pages. */
    spent,
    /** This frame's pages, the coarsest first, light view by light view. */
    admission,
    /** A node has moved: its box stales the pages it covers at the next plan. */
    worldChanged: changes.worldChanged,
    /** The same world at another precision: its box waits for the camera to rest. */
    representationChanged: changes.representationChanged,
    /** The threshold the light cuts select casters at, and their render origin (`thresholds.ts`). */
    setThreshold: thresholds.set,
    /** The camera rested at the last plan: its view was the one of the plan before. */
    get resting() {
      return resting;
    },
    /** True while a representation change waits for the camera to rest. */
    get deferredChanges() {
      return changes.deferred() || thresholds.pending;
    },
    /** The frame plans no shadow: the held union enters the list at once. */
    releaseDeferred: changes.releaseDeferred,
    /** Turns off per-page invalidation: a moving object stales every page of the lights it
     *  touches. On by default. */
    setPageInvalidation(on: boolean) {
      byPage = on;
    },
    /** Whether a moving object stales only the pages its box covers. */
    get pageInvalidation() {
      return byPage;
    },
    /** The state the next image gets: a report stamped with it naming nothing new, it holds. */
    stamp: stampOf,
    /** True once a report proves the current state asks for nothing: the image may hold. */
    settled: (store: SceneLightStore) => settledStamp === stampOf(store),
    /** A request report came back; the next plan reads it. A newer one replaces an unread one. */
    receive(next: ShadowRequestReport) {
      if (!report || next.frame > report.frame) report = next;
    },
    /** Plans a frame: stales what moved, reads the last report, admits every page to draw. */
    plan(
      store: SceneLightStore,
      view: ShadowViewpoint,
      sceneMin: ArrayLike<number>,
      sceneMax: ArrayLike<number>,
      frame: number,
      nowMs: number,
    ) {
      counts.beginFrame();
      records.release(store);
      const still = changes.observeView(view),
        quiet = still && !changes.worldMoved();
      resting = still;
      restFrame = quiet ? (restFrame < 0 ? frame : restFrame) : -1;
      if (!still) views++;
      // A full pool keeps the pages its cycle named: the rest's first frame, else this one.
      const cycle = quiet ? restFrame : frame;
      planLights(lightsState, store, view, sceneMin, sceneMax, frame, nowMs, byPage);
      gpu.noteFrame(frame, !quiet);
      changes.settled();
      if (still) counts.staled(STALE_BY.threshold, thresholds.restale(nowMs, frame));
      // Nothing moves: the pages of an older depth range are drawn in the current one.
      if (quiet) counts.staled(STALE_BY.range, sun.ranges.restale(pool, nowMs, frame));
      const readStart = performance.now();
      if (report) {
        const before = stampOf(store),
          read = report;
        report = null;
        // The pool follows the GPU's snapshot first; a mark or a miss narrows a page.
        if (!gpu.on || gpu.follow(read, nowMs, frame)) {
          footprints.widened = 0;
          footprints.read(read, nowMs, frame);
          requests.consume(read, nowMs, frame, cycle);
          counts.staled(STALE_BY.footprint, footprints.widened);
          const settled = read.stamp === before && requests.complete && !footprints.widened;
          if (settled) settledStamp = stampOf(store);
        }
      }
      const admitStart = performance.now();
      spent.requestsMs = admitStart - readStart;
      gpu.asks.count = 0;
      requests.floors(posed, view, nowMs, frame, cycle, gpu.on ? gpu.asks : undefined);
      const count = admission.run(pool, table, requests.latest, frame, records.isFloor);
      for (let i = 0; i < count; i++) {
        const slice = pool.slice[admission.list[i]];
        counts.drewLight(slice, records.kind[slice], frame);
      }
      // What the pool cannot hold waits for nothing: it is published, never pending.
      counts.endFrame(pool, records, requests.latest, nowMs, frame);
      spent.admissionMs = performance.now() - admitStart;
      return count;
    },
    /** Pages `[from, to)` were encoded, `from + i` in `modes[i]`; the last batch closes the list. */
    commit(modes?: ArrayLike<number>, from = 0, to = admission.count) {
      for (let i = from; i < to; i++) {
        const page = admission.list[i];
        pool.drew(table, page, modes ? modes[i - from] : DRAW_ALL, records.rangeOf(page));
        thresholds.drew(page);
      }
      if (to >= admission.count) admission.reset();
    },
    /** The list's pages from `from` on were not encoded: stale, pending, first next (`admit.ts`). */
    reissue(from = 0) {
      counts.pendingPages = Math.max(0, admission.count - from);
      admission.reset(from);
    },
    /** Starts over. */
    reset() {
      records.reset();
      table.reset();
      pool.reset();
      thresholds.reset();
      requests.reset();
      changes.reset();
      counts.reset();
      admission.reset();
      gpu.set(false, 0);
      report = null;
      resting = false;
      restFrame = -1;
      settledStamp = -1;
    },
    /** The pool at another size, its pages kept, its arrays anew: returns where each page went. */
    resize(side: number, poolLayers: number) {
      const moved = resizeShadowPool(pool, table, side, poolLayers),
        counted = requests.counts;
      thresholds.follow(moved);
      shadowPlan.requests = requests = createShadowRequests(table, pool, records, sun, counted);
      shadowPlan.gpu = gpu = createShadowMirror(table, pool, records, sun, gpu);
      shadowPlan.admission = admission = createShadowAdmission(pool.pages);
      return moved;
    },
  };
  return shadowPlan;
}
