import type { ShadowStaleReason } from '../../contracts/shadowMetrics.ts';
import { LIGHT_KIND, MAX_SHADOW_SLICES } from '../light/contracts.ts';
import type { ShadowPool } from './pool.ts';
import type { ShadowRecords } from './records.ts';

/**
 * Why a page turns stale, each a frame's count in `counts.staledBy` (#991): its light moved or
 * changed shape or frame; a still caster moved or changed; moving casters alone did; its casters'
 * representation changed (detail); it was drawn at another cut threshold than the one at rest; it
 * was drawn in another depth range than its sun's current one (`sunDepth.ts`).
 */
export const STALE_BY: Readonly<Record<ShadowStaleReason, number>> = {
  light: 0,
  caster: 1,
  moving: 2,
  detail: 3,
  threshold: 4,
  range: 5,
};
export const STALE_REASONS = Object.keys(STALE_BY) as ShadowStaleReason[];

/**
 * What the shadow scheduler did in a frame, in pages: pages staled, drawn, left pending — 0 unless
 * the frame could not encode its pages (`plan.reissue`) —, pages the image reads straight from the
 * cache, pages the pool holds; and its one wait, in ms and frames, of the oldest stale page the
 * image reads; and the shadow casters it found no slice for. Everything is allocated once.
 */
export function createShadowCounts() {
  /** Frame (plus one) of the last page drawn for each slice's light. */
  const drewAt = new Int32Array(MAX_SHADOW_SLICES);
  const counts = {
    lights: 0,
    sunLights: 0,
    invalidatedPages: 0,
    /** Of those, the pages staled for each reason (`STALE_BY`). */
    staledBy: new Int32Array(STALE_REASONS.length),
    /** Pages the invalidation examined — table entries the moved boxes cover, or pool pages when
     *  they cover more —: its work, which the pool's size does not set (`invalidate.ts`). */
    visitedPages: 0,
    pendingPages: 0,
    /** Pages the latest report read that were current: no draw, straight from the cache. */
    cachedPages: 0,
    poolPages: 0,
    waitedMs: 0,
    waitedFrames: 0,
    /** Shadow-casting lights past the `MAX_SHADOW_SLICES` slices: lit, never shadowed. */
    unslicedCasters: 0,
    beginFrame() {
      counts.lights = 0;
      counts.unslicedCasters = 0;
      counts.sunLights = 0;
      counts.invalidatedPages = counts.visitedPages = 0;
      counts.staledBy.fill(0);
    },
    /** `pages` pages turned stale for `reason` (`STALE_BY`). */
    staled(reason: number, pages = 1) {
      counts.invalidatedPages += pages;
      counts.staledBy[reason] += pages;
    },
    /** A page of this slice's light is drawn this frame: the light counts once per frame. */
    drewLight(slice: number, rank: number, frame: number) {
      if (drewAt[slice] === frame + 1) return;
      drewAt[slice] = frame + 1;
      counts.lights++;
      if (rank === LIGHT_KIND.directional) counts.sunLights++;
    },
    /** After admission: the wait of the oldest stale page the image reads, counted only while a
     *  report names it (`pool.since`, `readFrame`), and the pages read straight from the cache. */
    endFrame(
      pool: ShadowPool,
      records: ShadowRecords,
      latest: number,
      nowMs: number,
      frame: number,
    ) {
      const { pages, owner, slice, requested, dirty, valid, since, readFrame } = pool,
        { taken } = records;
      let cached = 0,
        waitedMs = 0,
        waitedFrames = 0;
      for (let page = 0; page < pages; page++) {
        if (owner[page] < 0 || !taken[slice[page]]) continue;
        const read = latest >= 0 && requested[page] >= latest;
        if (!dirty[page]) {
          if (read && valid[page]) cached++;
          continue;
        }
        if (!read) {
          since[page] = NaN;
          continue;
        }
        if (Number.isNaN(since[page])) {
          since[page] = nowMs;
          readFrame[page] = frame;
        }
        waitedMs = Math.max(waitedMs, nowMs - since[page]);
        waitedFrames = Math.max(waitedFrames, frame - readFrame[page]);
      }
      counts.pendingPages = 0;
      counts.cachedPages = cached;
      counts.poolPages = pool.used();
      counts.waitedMs = waitedMs;
      counts.waitedFrames = waitedFrames;
    },
    reset() {
      counts.beginFrame();
      counts.pendingPages = counts.cachedPages = counts.poolPages = 0;
      counts.waitedMs = counts.waitedFrames = 0;
      drewAt.fill(0);
    },
  };
  return counts;
}
