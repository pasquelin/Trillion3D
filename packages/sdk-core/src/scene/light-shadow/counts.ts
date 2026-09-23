import { LIGHT_KIND, LIGHT_SETTINGS } from '../light/contracts.ts';
import type { ShadowPool } from './pool.ts';
import type { ShadowRecords } from './records.ts';

/**
 * What the shadow scheduler did in a frame, in pages, never durations: pages staled, drawn,
 * left waiting — and the lag of the oldest —, pages the image reads straight from the cache,
 * pages the pool holds. Everything is allocated once.
 */
export function createShadowCounts() {
  const drewAt = new Int32Array(LIGHT_SETTINGS.maxLights);
  const counts = {
    denied: 0,
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
      counts.denied = 0;
      counts.lights = 0;
      counts.sunLights = 0;
      counts.invalidatedPages = 0;
    },
    deny() {
      counts.denied++;
    },
    /** A page of this slice's light is drawn this frame: the light counts once per frame. */
    drewLight(slice: number, rank: number, frame: number) {
      if (drewAt[slice] === frame + 1) return;
      drewAt[slice] = frame + 1;
      counts.lights++;
      if (rank === LIGHT_KIND.directional) counts.sunLights++;
    },
    /** What remains after admission: stale pages the image reads and that wait, and the lag
     *  of the oldest; one scan of the pool. */
    endFrame(
      pool: ShadowPool,
      records: ShadowRecords,
      latest: number,
      waiting: number,
      nowMs: number,
      frame: number,
    ) {
      counts.pendingPages = waiting;
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
