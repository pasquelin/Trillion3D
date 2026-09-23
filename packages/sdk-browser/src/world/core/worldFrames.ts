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
  /** Seconds since the previous frame, at most two frame intervals after a pause; 0 on the first. */
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

/**
 * How many display intervals a frame may span and still count as the loop running: one frame
 * drawn late, the one after it on time. A longer gap is a pause — a still scene the loop slept
 * through, a hidden tab — and not time the scene lived. It is a ratio of the display's own
 * interval, not a duration: its only effect on a loop that really slowed down is how fast the
 * measured interval follows it, by this factor per frame.
 */
const LATE_FRAMES = 2;

/**
 * THE DELTA IS BOUNDED BY THE DISPLAY'S OWN PACE. The loop sleeps in a still scene and the
 * browser stops it in a hidden tab, so the wall time since the last frame can be seconds long;
 * integrated as such, a held key, a cruising camera or a playing clip would leap. The first frame
 * after a pause therefore spans at most `LATE_FRAMES` of the last interval the loop measured, the
 * interval being the delta it last handed out; the first frame of all spans nothing.
 */
function boundedDelta() {
  let interval: number | null = null;
  return {
    /** The seconds from `previous` to `now` a frame integrates; `first` for the world's first. */
    read: (now: number, previous: number, first: boolean) => {
      if (first) return 0;
      const raw = (now - previous) / 1000;
      return interval === null ? raw : Math.min(raw, LATE_FRAMES * interval);
    },
    /** A frame drew with `delta`: it is the interval the next pause is bounded by. Two frames
     *  within one clock tick measure nothing, and a zero bound would never grow again. */
    drawn(delta: number) {
      if (delta > 0) interval = delta;
    },
  };
}

/** The per-frame hooks of a world, run in the order they were added, after each drawn frame. */
export function createWorldFrames() {
  const hooks = new Set<(frame: FrameInfo) => void>();
  const start = performance.now();
  let previous = start,
    frame = 0,
    last: WorldFrameMetrics | null = null;
  const pace = boundedDelta();
  const info: FrameInfo = { delta: 0, time: 0, frame: 0, metrics: NOT_DRAWN };
  return {
    get last() {
      return last;
    },
    /** Seconds since the last drawn frame, bounded after a pause: what a controller integrates. */
    delta: () => pace.read(performance.now(), previous, frame === 0),
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
      info.delta = pace.read(now, previous, frame === 0);
      pace.drawn(info.delta);
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
