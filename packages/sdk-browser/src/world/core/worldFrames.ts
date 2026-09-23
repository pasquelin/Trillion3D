import type { FrameMetrics } from '../../../../sdk-core/src/index.ts';

/** A frame's metrics, with the names a page reads them by; `null` where the path does not count. */
export type WorldFrameMetrics = FrameMetrics & {
  gpuFrameMs: number | null;
  /** Clusters the occlusion test found hidden this frame; `null` where the path does not count them. */
  hizCulled: number | null;
  /** Shadow pages held in memory this frame; `null` where the path has none. */
  shadowPagesResident: number | null;
};

/** What a frame hook receives: seconds since the last frame and since the world began. The
 *  world's one object, rewritten each frame: a hook that keeps a value copies it. */
export interface FrameInfo {
  /** Seconds since the previous frame. */
  delta: number;
  /** Seconds since the world began. */
  time: number;
  /** How many frames the world has drawn. */
  frame: number;
  /** What the last frame cost: triangles, pages, timings. */
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
  const info: FrameInfo = { delta: 0, time: 0, frame: 0, metrics: NOT_DRAWN };
  return {
    get last() {
      return last;
    },
    /** Seconds since the last drawn frame: what a steered controller integrates. */
    delta: () => (performance.now() - previous) / 1000,
    /**
     * Adds a function to run before every frame; returns the function that removes it.
     * @param hook - The function to run; it gets the frame's time and metrics.
     * @returns A function that stops the hook.
     */
    add(hook: (frame: FrameInfo) => void) {
      hooks.add(hook);
      return () => {
        hooks.delete(hook);
      };
    },
    dispatch(metrics: FrameMetrics) {
      const now = performance.now();
      info.delta = (now - previous) / 1000;
      info.time = (now - start) / 1000;
      info.frame = frame++;
      info.metrics = last = named(metrics);
      previous = now;
      for (const hook of hooks) hook(info);
    },
    clear() {
      hooks.clear();
    },
  };
}
