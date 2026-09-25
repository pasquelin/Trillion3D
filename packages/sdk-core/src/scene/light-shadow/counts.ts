import { LIGHT_KIND, MAX_SHADOW_SLICES } from '../light/contracts.ts';
import type { ShadowPool } from './pool.ts';
import type { ShadowRecords } from './records.ts';

/**
 * What the shadow scheduler did in a frame, in pages, never durations: pages staled, drawn, left
 * pending — past a moving frame's budget, or not encoded (`plan.reissue`) —, the lag of the oldest
 * stale page the image reads, pages the image reads straight from the cache, pages the pool holds.
 * Everything is allocated once.
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
    /** After admission: the lag of the oldest stale page the image reads, and the pages read
     *  straight from the cache; one scan of the pool. */
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
        if (pool.requested[page] < latest || latest < 0) continue;
        if (!pool.dirty[page]) {
          if (pool.valid[page]) counts.cachedPages++;
          continue;
        }
        counts.waitedMs = Math.max(counts.waitedMs, nowMs - pool.since[page]);
        counts.waitedFrames = Math.max(counts.waitedFrames, frame - pool.sinceFrame[page]);
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
