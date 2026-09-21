import {
  LIGHT_KIND,
  LIGHT_SETTINGS,
  SCENE_LIGHT_FLOATS,
  SCENE_LIGHT_HEADER_FLOATS,
  type ShadowViewpoint,
} from './sceneLightContracts.ts';
import { desiredFaceSide } from './sceneLightShadowAtlas.ts';
import { faceCountOf } from './sceneLightShadowFaces.ts';
import { createShadowSliceTable, RECTS_PER_SLICE } from './sceneLightShadowSlices.ts';
import { LIGHT_FIELD, type SceneLightStore } from './sceneLightStore.ts';
import { createShadowChanges } from './sceneLightShadowChanges.ts';
import { createShadowBudget } from './sceneLightShadowBudget.ts';
import { createShadowRegions } from './sceneLightShadowRegions.ts';
import { invalidateLightPages } from './sceneLightShadowInvalidate.ts';
import { pageRowsOf } from './sceneLightShadowPages.ts';
import { createShadowCounts, screenCoverage } from './sceneLightShadowCounts.ts';
import { createShadowAdmission } from './sceneLightShadowAdmit.ts';
import { createShadowRelease } from './sceneLightShadowRelease.ts';
import { castsShadow, countShadowCasters } from './sceneLightShadowCasters.ts';

export type ShadowPlan = ReturnType<typeof createShadowPlan>;

/**
 * The shadow scheduler. Work of a frame is no longer "four lights" but **the most
 * priority stale pages, up to a millisecond budget** (RX3, X4): a light or a
 * cascade that moves stales its whole map, an object that moves only stales the pages its projected
 * box covers, and pages refused this frame wait for the next — never lost,
 * their lag published. A fixed light in a still scene still costs nothing (X5).
 *
 * All arrays are allocated once; `plan()` will never allocate.
 */
export function createShadowPlan(capacity: number) {
  const slices = createShadowSliceTable();
  const changes = createShadowChanges();
  const budget = createShadowBudget();
  const regions = createShadowRegions(capacity);
  const counts = createShadowCounts();
  // Per-page invalidation can be turned off: the whole face then restarts, as before the batch.
  // This is the only way to compare the two rules on the same engine, to the same frame.
  let byPage = true;
  const coverage = new Float64Array(LIGHT_SETTINGS.maxLights);
  const queue = createShadowAdmission(regions, budget, counts);
  const release = createShadowRelease();
  return {
    slices,
    regions,
    budget,
    coverage,
    counts,
    /** A node has moved: its box enters the list the scheduler will consume next frame. */
    worldChanged: changes.worldChanged,
    /** The same world at another precision — level of detail, residency, colour tile —: its box
     *  waits for the camera to rest, then enters the list (`sceneLightShadowChanges.ts`). */
    representationChanged: changes.representationChanged,
    /** True while a representation change waits for the camera to rest: the frame must not
     *  hold before a plan consumes it. */
    get deferredChanges() {
      return changes.deferred;
    },
    /** The frame plans no shadow — no atlas, no light, unlit view —: nothing will consume the
     *  held union, so it is dropped rather than left to keep the frame from holding. */
    dropDeferred: changes.dropDeferred,
    /** Timer of a frame's Shadows pass, reported to the pages it had redrawn. */
    observeCost: budget.observe,
    setBudgetMs: budget.setBudgetMs,
    /** Turns off per-page invalidation: every touched face restarts in full. On by default. */
    setPageInvalidation(on: boolean) {
      byPage = on;
    },
    get pageInvalidation() {
      return byPage;
    },
    /**
     * Chooses the regions of this frame. Returns their count; `plan.regions` describes them one by
     * one, and the pages they cover are already removed from the queue.
     */
    plan(store: SceneLightStore, view: ShadowViewpoint, frame: number, nowMs: number) {
      const { packed } = store;
      regions.reset();
      queue.reset();
      counts.beginFrame();
      slices.dirty.beginFrame();
      // Before any slice request: those that no live shadow light claims anymore
      // go back to the common pot. This is the only place a slice is released.
      release(slices, store);
      changes.observeView(view);
      const casters = countShadowCasters(store);
      for (let slot = 0; slot < store.count; slot++) {
        const base = SCENE_LIGHT_HEADER_FLOATS + slot * SCENE_LIGHT_FLOATS;
        coverage[slot] = 0;
        // Its slice has already been released by `release`: the light skips its turn, with no other effect.
        if (!castsShadow(store, slot)) continue;
        let slice = store.sliceOf(slot);
        const kind = packed[base + LIGHT_FIELD.kind];
        const sun = kind === LIGHT_KIND.directional;
        // The sun lights the whole screen: its priority is maximal. A point is worth the
        // screen share its influence sphere occupies — the nearest light therefore goes first.
        coverage[slot] = sun
          ? 1
          : screenCoverage(
              view,
              packed[base],
              packed[base + 1],
              packed[base + 2],
              packed[base + LIGHT_FIELD.range],
            );
        const faces = faceCountOf(kind);
        if (slice < 0) slice = slices.claim();
        const side = desiredFaceSide(coverage[slot], faces, casters);
        if (slice < 0 || !slices.fit(slice, faces, side)) {
          counts.deny();
          coverage[slot] = 0;
          store.assignSlice(slot, -1);
          continue;
        }
        store.assignSlice(slot, slice);
        const light = store.light(store.ids[slot]);
        if (!light) continue;
        invalidateLightPages(
          slices,
          changes,
          light,
          slice,
          faces,
          slices.side[slice],
          store.revision[slot],
          view,
          nowMs,
          frame,
          byPage,
        );
        const rows = pageRowsOf(slices.side[slice]);
        let waiting = false;
        for (let face = 0; face < faces; face++) {
          if (!slices.dirty.isDirty(slice, face)) continue;
          waiting = true;
          // Priority: the most visible light first, a never-drawn map before everything, and
          // the wait already suffered, which rises frame by frame and prevents starvation.
          queue.add(
            slot,
            slice,
            face,
            rows,
            coverage[slot] +
              (slices.drawn[slice] ? 0 : 1) +
              slices.dirty.waitedFrames(slice, face, frame) * LIGHT_SETTINGS.shadowAgingPerFrame,
          );
        }
        if (!waiting) counts.reusedLight();
      }
      // The boxes are consumed: it is the pages that now carry the remaining work.
      changes.settled();
      queue.run(slices, store, frame);
      counts.endFrame(slices, store, frame, nowMs);
      return regions.count;
    },
    /**
     * The regions of this frame could not be encoded: their pages return to the queue. They
     * had left it at admission, because the scheduler and the pass only talk through
     * this list; if the pass draws nothing, the queue must find them again.
     */
    reissue(frame: number, nowMs: number) {
      for (let region = 0; region < regions.count; region++)
        slices.dirty.undrew(
          regions.sliceOf(region),
          regions.faceOf(region),
          regions.x0Of(region),
          regions.x1Of(region),
          regions.y0Of(region),
          regions.y1Of(region),
          regions.heldLowOf(region),
          regions.heldHighOf(region),
          nowMs,
          frame,
        );
      regions.reset();
    },
    reset() {
      slices.reset();
      changes.reset();
      budget.reset();
      regions.reset();
      counts.reset();
    },
  };
}
export { RECTS_PER_SLICE };
