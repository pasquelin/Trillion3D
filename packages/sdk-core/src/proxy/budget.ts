import { BOUNCE_SETTINGS } from '../bounce/contracts.ts'
import { clamp, clampLowWins, lerp } from '../../../math/src/scalar/reals.ts'

/**
 * Work units the proxy's traversal runs a millisecond, before any measure: 1.7 million units cost
 * 0.5 ms of the reflection trace on the generated scene (Metal, M2). Only the first frames read it:
 * the rate is the device's own from its first measure on.
 */
const PROXY_UNITS_PER_MS = 3.4e6
/** The most units a frame's reflection rays may spend: the trace's counter is one 32-bit word. */
const MOST_UNITS = 2 ** 31

/**
 * THE ONE BUDGET OF THE PROXY'S RAYS, a GPU duration, never a ray count: the reflections' rays and the
 * bounce probes' share `budgetMs` of every frame, the reflections first — what the screen shows —, the
 * probes the rest, which converge over frames by design. Both are cut by it: the reflection rays a frame
 * leaves out go on in the next frames from the answers their pixels last got (`reflections/proxyStore.ts`).
 *
 * Closed on the device's own measures, never one machine's constant: the reflection trace's work
 * units a frame (`spent`, read back without a wait) over its pass's GPU time give the device's rate,
 * smoothed, and the next frame's reflection rays may spend `rate × budgetMs` units (`units`). The
 * pass's time holds the screen march beside the proxy's rays, so the rate is a lower bound and the
 * pass stays inside the share. The probes take `budgetMs` less what the reflection trace's pass took,
 * never past their own part of it (`probeShare`) — a scene without reflections leaves them no more
 * than they had alone —, their fraction of the published ceiling (`load`) servoed on their own
 * pass's time, bounded between the progress floor and one.
 *
 * A missing, zero or non-finite measure moves nothing: the loop never follows an artificial zero.
 */
export interface ProxyBudget {
  /** Target GPU duration of every proxy ray of a frame, in milliseconds. */
  readonly budgetMs: number
  /** Work units the next frame's reflection rays may spend. */
  readonly units: number
  /** Fraction of the probes' ceiling to encode: bounded between floor and 1. */
  readonly load: number
  /** Last observed probe pass duration, or `null` until recorded. */
  readonly lastMs: number | null
  /** Retained probe samples. Zero means the device measures no timestamp. */
  readonly samples: number
  /** The work units a recent frame's reflection rays spent, as the trace counted them. */
  spent(units: number): void
  /** The GPU durations of the reflection trace's pass and of the probes' pass, in milliseconds. */
  observe(reflectionMs: number | null, probeMs: number | null): void
}

/** Work batch for a frame: fraction of published ceiling sustainable under budget, non-zero. */
export function bounceBatchOf(ceiling: number, load: number) {
  return Math.max(1, Math.round(ceiling * load))
}

const measured = (ms: number | null): ms is number => ms !== null && Number.isFinite(ms) && ms > 0

/** Keeps every proxy ray of a frame under one GPU duration, frame after frame. */
export function createProxyBudget(budgetMs: number): ProxyBudget {
  const share = Number.isFinite(budgetMs) && budgetMs > 0 ? budgetMs : BOUNCE_SETTINGS.budgetMs
  const { budgetSmoothing, budgetFloor, probeShare } = BOUNCE_SETTINGS
  let rate = PROXY_UNITS_PER_MS,
    lastUnits = 0,
    load = 1,
    lastMs: number | null = null,
    samples = 0
  return {
    budgetMs: share,
    get units() {
      return Math.min(MOST_UNITS, Math.round(rate * share))
    },
    get load() {
      return load
    },
    get lastMs() {
      return lastMs
    },
    get samples() {
      return samples
    },
    spent(units) {
      if (Number.isFinite(units) && units > 0) lastUnits = units
    },
    observe(reflectionMs, probeMs) {
      // A frame's units are read once: a still view, whose trace spends nothing, keeps its rate.
      if (measured(reflectionMs) && lastUnits > 0) {
        rate = lerp(rate, lastUnits / reflectionMs, budgetSmoothing)
        lastUnits = 0
      }
      if (!measured(probeMs)) return
      lastMs = probeMs
      samples++
      const left = clampLowWins(
        share - (measured(reflectionMs) ? reflectionMs : 0),
        share * budgetFloor,
        share * probeShare,
      )
      const wanted = clamp((load * left) / probeMs, budgetFloor, 1)
      load = clamp(lerp(load, wanted, budgetSmoothing), budgetFloor, 1)
    },
  }
}
