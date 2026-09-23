/**
 * Pages the shadow pass drew since the last control or camera change, read from the cumulative
 * `shadowPagesTotal` of each rendered frame — so the settle drains of the previous frame count
 * too. What a change cost the cached shadow maps, and what the lesson shows beside the triangles.
 */
import type { FrameMetrics } from '../../packages/sdk-browser/src/index.ts';

export function createShadowPageCounter() {
  let total = 0,
    since = 0;
  return {
    observe(metrics: FrameMetrics) {
      const now = metrics.shadowPagesTotal ?? total;
      since += Math.max(0, now - total);
      total = now;
      return since;
    },
    reset() {
      since = 0;
    },
  };
}
