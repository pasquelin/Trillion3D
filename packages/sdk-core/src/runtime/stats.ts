/** A frame interval longer than this, in milliseconds, is a stutter. */
export const STUTTER_MS = 50;

/** The value at rank `p` (in (0, 1]) of a sorted, non-empty list, never interpolated. */
function quantile(sorted: readonly number[], p: number) {
  return sorted[Math.ceil(p * sorted.length) - 1];
}

/** The mean, median, 95th, 99th and worst of a list of times. */
export function summarize(values: readonly number[]) {
  if (!values.length || values.some((v) => !Number.isFinite(v) || v < 0)) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return {
    mean: values.reduce((a, b) => a + b, 0) / values.length,
    p50: quantile(sorted, 0.5),
    p95: quantile(sorted, 0.95),
    p99: quantile(sorted, 0.99),
    max: sorted.at(-1)!,
  };
}

/** Frame rate and smoothness from the times between frames. */
export function frameStatistics(intervals: readonly number[]) {
  const finite = intervals.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (!finite.length)
    return {
      fps: null,
      p50Ms: null,
      p95Ms: null,
      p99Ms: null,
      onePercentLowFps: null,
      stutters: null,
    };
  const worst = finite.slice(-Math.max(1, Math.ceil(finite.length * 0.01)));
  return {
    fps: 1000 / (finite.reduce((a, b) => a + b, 0) / finite.length),
    p50Ms: quantile(finite, 0.5),
    p95Ms: quantile(finite, 0.95),
    p99Ms: quantile(finite, 0.99),
    onePercentLowFps: 1000 / (worst.reduce((a, b) => a + b, 0) / worst.length),
    stutters: finite.filter((v) => v > STUTTER_MS).length,
  };
}
