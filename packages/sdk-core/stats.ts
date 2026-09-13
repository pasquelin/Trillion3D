const STUTTER_MS = 50;

function quantile(sorted: readonly number[], p: number) {
  if (!sorted.length) return undefined;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
}

export function summarize(values: readonly number[]) {
  if (!values.length || values.some(v => !Number.isFinite(v) || v < 0)) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return {
    mean: values.reduce((a, b) => a + b, 0) / values.length,
    p50: quantile(sorted, .5)!,
    p95: quantile(sorted, .95)!,
    p99: quantile(sorted, .99)!,
    max: sorted.at(-1)!,
  };
}

export function frameStatistics(intervals: readonly number[]) {
  const finite = intervals.filter(v => Number.isFinite(v) && v > 0).slice().sort((a, b) => a - b);
  if (!finite.length) return {fps: null, p50Ms: null, p95Ms: null, p99Ms: null, onePercentLowFps: null, stutters: null};
  const worst = finite.slice(-Math.max(1, Math.ceil(finite.length * .01)));
  return {
    fps: 1000 / (finite.reduce((a, b) => a + b, 0) / finite.length),
    p50Ms: quantile(finite, .5)!,
    p95Ms: quantile(finite, .95)!,
    p99Ms: quantile(finite, .99)!,
    onePercentLowFps: 1000 / (worst.reduce((a, b) => a + b, 0) / worst.length),
    stutters: finite.filter(v => v > STUTTER_MS).length,
  };
}
