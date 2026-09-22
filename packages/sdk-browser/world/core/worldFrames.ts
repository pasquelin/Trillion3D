import type { FrameMetrics } from '../../../sdk-core/index.ts';

/** What a frame hook receives: seconds since the last frame and since the world began. */
/** A frame's metrics, with the names a page reads them by; `null` where the path does not count. */
export type WorldFrameMetrics = FrameMetrics & {
  gpuFrameMs: number | null;
  hizCulled: number | null;
  shadowPagesResident: number | null;
};

export interface FrameInfo {
  delta: number;
  time: number;
  frame: number;
  metrics: WorldFrameMetrics;
}

/** The engine's metrics under a page's names: the GPU frame, the clusters the occlusion test
 *  rejected, the shadow pages held (all of them less those still waiting). */
function named(m: FrameMetrics): WorldFrameMetrics {
  const total = m.shadowPagesTotal,
    pending = m.shadowPagesPending;
  return Object.assign(m, {
    gpuFrameMs: m.gpuMs,
    hizCulled: m.hizRejectedClusters ?? null,
    shadowPagesResident: total != null && pending != null ? total - pending : null,
  });
}

/**
 * What a page reads before the world's first frame: a host-led loop asks for the metrics right
 * after `render()`, which draws nothing until the renderer is ready. No frame ran, so nothing was
 * spent, loaded or drawn: the counts that a frame measures are `null`, the totals are zero.
 */
export const NOT_DRAWN: Readonly<WorldFrameMetrics> = Object.freeze({
  rafIntervalMs: null,
  cpuFrameMs: 0,
  cpuSubmitMs: null,
  gpuMs: null,
  drawCalls: null,
  triangles: null,
  clusters: null,
  selectedTriangles: null,
  residentPages: null,
  geometryAllocationBytes: null,
  vramBytes: null,
  pageLoads: 0,
  pageBytesRead: 0,
  gpuFrameMs: null,
  hizCulled: null,
  shadowPagesResident: null,
});

/** The per-frame hooks of a world, run in the order they were added, after each drawn frame. */
export function createWorldFrames() {
  const hooks = new Set<(frame: FrameInfo) => void>();
  const start = performance.now();
  let previous = start,
    frame = 0,
    last: WorldFrameMetrics | null = null;
  return {
    get last() {
      return last;
    },
    /** Seconds since the last drawn frame: what a steered controller integrates. */
    delta: () => (performance.now() - previous) / 1000,
    add(hook: (frame: FrameInfo) => void) {
      hooks.add(hook);
      return () => {
        hooks.delete(hook);
      };
    },
    dispatch(metrics: FrameMetrics) {
      const now = performance.now();
      const info = {
        delta: (now - previous) / 1000,
        time: (now - start) / 1000,
        frame,
        metrics: named(metrics),
      };
      previous = now;
      frame++;
      last = info.metrics;
      for (const hook of [...hooks]) hook(info);
    },
    clear() {
      hooks.clear();
    },
  };
}
