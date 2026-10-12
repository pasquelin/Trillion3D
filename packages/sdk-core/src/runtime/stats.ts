import { mean, summaryOf } from '../../../math/src/scalar/quantile.ts'

/** A frame interval longer than this, in milliseconds, is a stutter. */
export const STUTTER_MS = 50

/** The mean, median, 95th, 99th and worst of a list of times. */
export function summarize(values: readonly number[]) {
  if (values.some((v) => !Number.isFinite(v) || v < 0)) return null
  const found = summaryOf(values)
  return (
    found && { mean: found.mean, p50: found.p50, p95: found.p95, p99: found.p99, max: found.max }
  )
}

/** Frame rate and smoothness from the times between frames. */
export function frameStatistics(intervals: readonly number[]) {
  const finite = intervals.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b)
  const found = summaryOf(finite)
  if (!found)
    return {
      fps: null,
      p50Ms: null,
      p95Ms: null,
      p99Ms: null,
      onePercentLowFps: null,
      stutters: null,
    }
  const worst = finite.slice(-Math.max(1, Math.ceil(finite.length * 0.01)))
  return {
    fps: 1000 / found.mean,
    p50Ms: found.p50,
    p95Ms: found.p95,
    p99Ms: found.p99,
    onePercentLowFps: 1000 / mean(worst),
    stutters: finite.filter((v) => v > STUTTER_MS).length,
  }
}
