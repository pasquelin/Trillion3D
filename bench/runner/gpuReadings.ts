import type { FrameMetrics } from '../../packages/sdk-core/src/index.ts';

/**
 * The device's readings of a series, one per sampled image and not per render — the device is
 * sampled every few images —: its GPU frame time, and the idle before it where the image before it
 * was sampled too (#1451). Both come from the same run, so the two are read together.
 */
export function gpuReadings() {
  const gpuFrameMs: number[] = [],
    gpuIdleMs: number[] = [];
  let sampled: number | null = null;
  return {
    gpuFrameMs,
    gpuIdleMs,
    /** A render's metrics: kept once per sampled image. */
    push(frame: Partial<FrameMetrics>) {
      const sample = frame.gpuPassMs;
      if (!sample || sample.frame === sampled) return;
      sampled = sample.frame;
      if (typeof frame.gpuFrameMs === 'number') gpuFrameMs.push(frame.gpuFrameMs);
      if (typeof frame.gpuIdleMs === 'number') gpuIdleMs.push(frame.gpuIdleMs);
    },
  };
}
