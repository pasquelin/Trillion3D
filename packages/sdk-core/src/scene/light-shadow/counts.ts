import { LIGHT_KIND, MAX_SHADOW_SLICES } from '../light/contracts.ts';
import type { ShadowPool } from './pool.ts';
import type { ShadowRecords } from './records.ts';

/**
 * What the shadow scheduler did in a frame, in pages: pages staled, drawn, left pending — 0 unless
 * the frame could not encode its pages (`plan.reissue`) —, pages the image reads straight from the
 * cache, pages the pool holds; and its one wait, in ms and frames, of the oldest stale page the
 * image reads. Everything is allocated once.
 */
export function createShadowCounts() {
  /** Frame (plus one) of the last page drawn for each slice's light. */
  const drewAt = new Int32Array(MAX_SHADOW_SLICES);
  const counts = {
    lights: 0,
    sunLights: 0,
    invalidatedPages: 0,
    pendingPages: 0,
    /** Pages the latest report read that were current: no draw, straight from the cache. */
    cachedPages: 0,
    poolPages: 0,
    waitedMs: 0,
    waitedFrames: 0,
    beginFrame() {
      counts.lights = 0;
      counts.sunLights = 0;
      counts.invalidatedPages = 0;
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
      counts.pendingPages = 0;
      counts.cachedPages = 0;
      counts.poolPages = pool.used;
      counts.waitedMs = 0;
      counts.waitedFrames = 0;
      for (let page = 0; page < pool.pages; page++) {
        if (pool.owner[page] < 0 || !records.taken[pool.slice[page]]) continue;
        const read = latest >= 0 && pool.requested[page] >= latest;
        if (!pool.dirty[page]) {
          if (read && pool.valid[page]) counts.cachedPages++;
          continue;
        }
        const unread = Number.isNaN(pool.since[page]);
        if (!read) {
          if (!unread) pool.since[page] = NaN;
          continue;
        }
        if (unread) {
          pool.since[page] = nowMs;
          pool.readFrame[page] = frame;
        }
        counts.waitedMs = Math.max(counts.waitedMs, nowMs - pool.since[page]);
        counts.waitedFrames = Math.max(counts.waitedFrames, frame - pool.readFrame[page]);
      }
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
