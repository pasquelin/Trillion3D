// The robust value of a series of graphics timings (`hardwareBenchmark.ts`).

/** `a + alpha (b - a)` in single precision, cut to a whole number. */
const lerpIndex = (a: number, b: number, alpha: number) =>
  Math.trunc(Math.fround(a + Math.fround(alpha * (b - a))))

/** The mean of `sorted` over `[from, to)`, half its spread, and how many values it holds. */
function windowOf(sorted: readonly number[], from: number, to: number) {
  let sum = 0,
    min = Infinity,
    max = -Infinity
  for (let i = from; i < to; i++) {
    min = Math.min(min, sorted[i])
    max = Math.max(max, sorted[i])
    sum += sorted[i]
  }
  const count = Math.max(0, to - from)
  return count
    ? { mean: sum / count, delta: (max - min) * 0.5, count }
    : { mean: 0, delta: 0, count }
}

/**
 * The robust value of a test's timings, one per iteration, with its confidence (0 to 100, the
 * share of the samples kept): the first third dropped, the rest sorted, then the mean of a window
 * widened from the middle in ten steps, kept until the window's spread passes half its mean.
 */
export function seriesValue(values: readonly number[]) {
  const sorted = values.slice(Math.floor(values.length / 3)).sort((a, b) => a - b)
  let value = 0,
    confidence = 0
  const passes = 10
  for (let pass = 0; pass < passes; pass++) {
    const alpha = Math.fround((pass + 1) / passes)
    const mid = Math.floor(sorted.length / 2)
    const { mean, delta, count } = windowOf(
      sorted,
      lerpIndex(mid, 0, alpha),
      lerpIndex(mid, sorted.length, alpha),
    )
    if (pass > 0 && delta > mean * 0.5) break
    confidence = count ? (100 * count) / sorted.length : 0
    value = mean
  }
  return { value, confidence }
}
