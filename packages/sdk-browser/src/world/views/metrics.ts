import type { FrameMetrics } from '../../../../sdk-core/src/index.ts';
import type { RenderBackend } from '../../backend/types.ts';

/** Per-draw counts add; shared residency and allocations remain the backend's single totals. */
const COUNTS = [
  'drawCalls',
  'clusters',
  'selectedTriangles',
  'drawnTriangles',
  'submittedTriangles',
  'totalSubmittedTriangles',
  'uncoveredTriangles',
  'frustumRejected',
  'transparentDrawCalls',
  'transparentSubmittedTriangles',
  'cpuSubmitMs',
  'cpuSelectMs',
] as const;

/** A multi-view frame never reports its last eye's timestamp as a timestamp of the entire frame. */
export function createViewMetrics() {
  const totals = {} as Record<(typeof COUNTS)[number], number | null>;
  let count = 0,
    held = true,
    coverage = true;
  return {
    reset() {
      count = 0;
      held = true;
      coverage = true;
    },
    add(backend: RenderBackend) {
      const metrics = backend.metrics();
      for (const key of COUNTS) {
        const value = metrics[key];
        totals[key] =
          typeof value !== 'number' || (count && totals[key] === null)
            ? null
            : (count ? totals[key]! : 0) + value;
      }
      held &&= backend.frameHeld === true;
      coverage &&= metrics.coverageReady === true;
      count++;
    },
    publish(into: FrameMetrics) {
      if (count < 2) return;
      Object.assign(into, totals);
      into.frameHeld = held;
      into.coverageReady = coverage;
      // GPU timestamps are asynchronous per-view samples; no frame-wide query exists yet.
      into.gpuFrameMs = into.gpuHostGapMs = null;
      into.gpuPassMs = null;
      into.gpuLightListsMs = into.gpuShadowsMs = into.gpuShadowCullMs = null;
      into.gpuShadowRasterMs = into.gpuLightingMs = null;
    },
  };
}
