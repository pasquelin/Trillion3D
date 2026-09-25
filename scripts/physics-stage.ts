import type { ProfileWindow } from '../site/examples/kit/profile.ts';

/** A clock over the windows: the median of their p50s and of their p95s, and the worst p95. */
export interface StageSpread {
  p50: number;
  p95: number;
  worstP95: number;
}

/** What the physics-stage proof reports of `ten-thousand-bodies` (`physics-stage.browser.ts`). */
export interface PhysicsStageReading {
  windows: number;
  /** Frames drawn per one-second window: the median and the lowest. */
  fps: { p50: number; min: number } | null;
  /** The page's `physics` CPU stage. */
  physicsMs: StageSpread | null;
  /** The worker's step. */
  workerStepMs: StageSpread | null;
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
};

/** A clock's spread over the windows that measured it, `null` when none did. */
function over(spreads: Array<{ p50: number; p95: number } | null>): StageSpread | null {
  const kept = spreads.filter((spread) => spread !== null);
  if (!kept.length) return null;
  const p95s = kept.map(({ p95 }) => p95);
  return {
    p50: median(kept.map(({ p50 }) => p50)),
    p95: median(p95s),
    worstP95: Math.max(...p95s),
  };
}

/** The reading of consecutive one-second profile windows (`window.__profile`, kit `profile.ts`). */
export function physicsStageReading(windows: ProfileWindow[]): PhysicsStageReading {
  const frames = windows.map((window) => window.frames);
  return {
    windows: windows.length,
    fps: frames.length ? { p50: median(frames), min: Math.min(...frames) } : null,
    physicsMs: over(windows.map((window) => window.physicsMs)),
    workerStepMs: over(windows.map((window) => window.workerStepMs)),
  };
}
