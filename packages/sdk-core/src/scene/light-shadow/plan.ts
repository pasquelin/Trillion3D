import { LIGHT_KIND, lightDirection, type ShadowViewpoint } from '../light/contracts.ts';
import { LIGHT_FIELD, type SceneLightStore } from '../light/store.ts';
import { createShadowChanges } from './changes.ts';
import { createShadowBudget } from './budget.ts';
import { invalidateLightPages } from './invalidate.ts';
import { createShadowCounts } from './counts.ts';
import { createShadowAdmission } from './admit.ts';
import { baseOf, castsShadow } from './casters.ts';
import { createShadowTable } from './table.ts';
import { DRAW_ALL, createShadowPool } from './pool.ts';
import { createSunLevels } from './sunLevels.ts';
import { createShadowRecords } from './records.ts';
import { createShadowRequests, type ShadowRequestReport } from './requests.ts';
import { createShadowThresholds } from './thresholds.ts';

/** The frame's shadow work: which virtual pages are drawn, and which wait. */
export type ShadowPlan = ReturnType<typeof createShadowPlan>;

/**
 * The shadow scheduler of the virtual maps. The shading records the pages it reads; their
 * report, read back frames later, allocates what is missing from the fixed pool. What moved stales
 * the mapped pages it covers. A frame then draws the stale pages the image reads — coarse first,
 * up to a millisecond budget —, and the rest waits, never lost, its lag published. A still scene,
 * whose shading runs no more, asks for nothing and draws nothing.
 *
 * All arrays are allocated once; `plan()` allocates nothing.
 */
export function createShadowPlan(capacity: number, poolSide: number) {
  const table = createShadowTable(poolSide * poolSide),
    pool = createShadowPool(poolSide),
    sun = createSunLevels(),
    records = createShadowRecords(table, pool, sun),
    requests = createShadowRequests(table, pool, records, sun),
    changes = createShadowChanges(),
    budget = createShadowBudget(),
    counts = createShadowCounts(),
    admission = createShadowAdmission(capacity, pool.pages),
    thresholds = createShadowThresholds(pool),
    posed = new Int32Array(records.taken.length);
  let byPage = true,
    report: ShadowRequestReport | null = null,
    resting = false,
    views = 0,
    settledStamp = -1;
  const stampOf = (store: SceneLightStore) => table.version + views + store.epoch;
  return {
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
    /** The Shadows-stage millisecond budget and the measured cost of a page. */
    budget,
    /** What the last plan did, in pages. */
    counts,
    /** This frame's pages, in admission order. */
    admission,
    /** A node has moved: its box stales the pages it covers at the next plan. */
    worldChanged: changes.worldChanged,
    /** The same world at another precision: its box waits for the camera to rest. */
    representationChanged: changes.representationChanged,
    /** The threshold the light cuts select casters at (`thresholds.ts`). */
    setThreshold: thresholds.set,
    /** The camera rested at the last plan: its view was the one of the plan before. */
    get resting() {
      return resting;
    },
    /** True while a representation change waits for the camera to rest. */
    get deferredChanges() {
      return changes.deferred || thresholds.pending;
    },
    /** The frame plans no shadow: the held boxes enter the list at once. */
    releaseDeferred: changes.releaseDeferred,
    /** Timer of a frame's Shadows pass, reported to the pages it drew. */
    observeCost: budget.observe,
    /** Budget published by the host, in GPU milliseconds per frame. */
    setBudgetMs: budget.setBudgetMs,
    /** Turns off per-page invalidation: a moving object stales every page of the lights it
     *  touches. On by default. */
    setPageInvalidation(on: boolean) {
      byPage = on;
    },
    /** Whether a moving object stales only the pages its box covers. */
    get pageInvalidation() {
      return byPage;
    },
    /** What the shading, the lights and the view hand the next image: a report stamped with it
     *  and naming nothing new proves the image reads only what is drawn. */
    stamp: stampOf,
    /** True once a report proves the current state asks for nothing: the image may hold. */
    settled: (store: SceneLightStore) => settledStamp === stampOf(store),
    /** A request report came back; the next plan reads it. A newer one replaces an unread one. */
    receive(next: ShadowRequestReport) {
      if (!report || next.frame > report.frame) report = next;
    },
    /** Plans a frame: stales what moved, reads the last report, admits the pages to draw. */
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
      const still = changes.observeView(view);
      resting = still;
      if (!still) views++;
      for (let slot = 0; slot < store.count; slot++) {
        if (!castsShadow(store, slot)) continue;
        const rank = store.packed[baseOf(slot) + LIGHT_FIELD.kind];
        let slice = store.sliceOf(slot);
        if (slice < 0 && (slice = records.claim()) >= 0) posed[slice] = frame;
        if (slice < 0) {
          counts.deny();
          store.assignSlice(slot, -1);
          continue;
        }
        records.fit(slice, rank);
        store.assignSlice(slot, slice);
        const light = store.light(store.ids[slot]);
        if (!light) continue;
        let whole = records.moved(slice, light);
        if (rank === LIGHT_KIND.directional) {
          if (sun.update(slice, lightDirection(light), view, sceneMin, sceneMax, frame))
            whole = true;
          for (let page = 0; page < pool.pages; page++)
            if (pool.owner[page] >= 0 && pool.slice[page] === slice)
              if (sun.movedLevel(slice, pool.view[page]))
                if (!sun.holds(slice, pool.view[page], pool.x[page], pool.y[page]))
                  pool.release(table, page);
        }
        counts.invalidatedPages += invalidateLightPages(
          pool,
          table,
          sun,
          changes,
          light,
          slice,
          whole,
          byPage,
          nowMs,
          frame,
        );
        if (whole) posed[slice] = frame;
      }
      changes.settled();
      if (still) counts.invalidatedPages += thresholds.restale(nowMs, frame);
      if (report) {
        const before = stampOf(store),
          read = report;
        report = null;
        requests.consume(read, nowMs, frame);
        if (read.stamp === before && requests.complete) settledStamp = stampOf(store);
      }
      requests.floors(posed, view, nowMs, frame);
      const left = admission.run(pool, table, records, sun, budget, requests.latest, frame, posed);
      for (let i = 0; i < admission.count; i++) {
        const slice = pool.slice[admission.list[i]];
        counts.drewLight(slice, records.kind[slice], frame);
      }
      // What the pool cannot hold waits for nothing: it is published, never pending.
      counts.endFrame(pool, records, requests.latest, left, nowMs, frame);
      return admission.count;
    },
    /** The frame's pages were encoded, each in its `modes` entry: their draws land before
     *  anything reads them. */
    commit(modes?: ArrayLike<number>) {
      for (let i = 0; i < admission.count; i++) {
        pool.drew(table, admission.list[i], modes ? modes[i] : DRAW_ALL);
        thresholds.drew(admission.list[i]);
      }
      admission.reset();
    },
    /** The frame's pages could not be encoded: they stay stale, and wait for the next frame. */
    reissue() {
      admission.reset();
    },
    /** Starts over. */
    reset() {
      records.reset();
      table.reset();
      pool.reset();
      thresholds.reset();
      requests.reset();
      changes.reset();
      budget.reset();
      counts.reset();
      admission.reset();
      report = null;
      resting = false;
      settledStamp = -1;
    },
  };
}
