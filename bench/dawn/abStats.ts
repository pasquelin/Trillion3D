// The verdict of an A/B: rounds alternate the two sides, so the difference B − A of each round is
// taken between plays close in time, and the drift the machine has between rounds cancels. The
// verdict reads the interval of the mean difference: a gain or a loss only when the interval holds
// no zero and the mean passes the least difference that matters; else noise.
import { spread } from './summary.ts'

/** Two-sided 95 % Student quantiles, by degrees of freedom 1…30; the normal beyond. */
const T95 = [
  12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145,
  2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048,
  2.045, 2.042,
]

export type Verdict = 'gain' | 'loss' | 'noise'
/** The mean difference B − A (ms, negative when B is faster), its 95 % interval, and the verdict. */
export type Comparison = {
  rounds: number
  aMs: number
  bMs: number
  meanMs: number
  lowMs: number
  highMs: number
  relative: number
  verdict: Verdict
}

/** The comparison of the paired plays: `a[i]` and `b[i]` the frame times of round `i`, `least` ms the
 *  smallest difference that counts. Needs two rounds at least. */
export function compare(a: readonly number[], b: readonly number[], least = 0.05): Comparison {
  if (a.length !== b.length || a.length < 2)
    throw new Error('BENCH_AB: a verdict needs two paired rounds')
  // A round either side of which gave no time says nothing: it is left out, and the rest must stand.
  const diffs = b.map((v, i) => v - a[i]).filter(Number.isFinite)
  if (diffs.length < 2)
    throw new Error('BENCH_AB: a verdict needs two rounds that gave a time on both sides')
  const d = spread(diffs)!
  const n = diffs.length
  const { mean } = d
  const sd = Math.sqrt(diffs.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1))
  const half = (T95[n - 2] ?? 1.96) * (sd / Math.sqrt(n))
  const [low, high] = [mean - half, mean + half]
  const aMs = spread(a)!.median
  const verdict: Verdict = high < -least ? 'gain' : low > least ? 'loss' : 'noise'
  return {
    rounds: n,
    aMs,
    bMs: spread(b)!.median,
    meanMs: mean,
    lowMs: low,
    highMs: high,
    relative: mean / aMs,
    verdict,
  }
}
