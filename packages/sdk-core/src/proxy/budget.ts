import { BOUNCE_SETTINGS } from '../bounce/contracts.ts'
import { clamp, clampLowWins, lerp } from '../../../math/src/scalar/reals.ts'

/**
 * THE ONE BUDGET OF THE PROXY'S RAYS, a GPU duration, never a ray count: the reflections' rays and the
 * bounce probes' share `budgetMs` of every frame, the reflections first — what the screen shows, every
 * ray of them cast in its frame, its cost reported, never cut —, the probes the rest, which converge over
 * frames by design.
 *
 * Closed on the device's own measures, never one machine's constant: the probes take `budgetMs` less
 * what the reflection trace's pass took, never past their own part of it (`probeShare`) — a scene
 * without reflections leaves them no more than they had alone —, their fraction of the published
 * ceiling (`load`) servoed on their own pass's time, bounded between the progress floor and one.
 *
 * A missing, zero or non-finite measure moves nothing: the loop never follows an artificial zero.
 */
export interface ProxyBudget {
  /** Target GPU duration of every proxy ray of a frame, in milliseconds. */
  readonly budgetMs: number
  /** Fraction of the probes' ceiling to encode: bounded between floor and 1. */
  readonly load: number
  /** Last observed probe pass duration, or `null` until recorded. */
  readonly lastMs: number | null
  /** Retained probe samples. Zero means the device measures no timestamp. */
  readonly samples: number
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
  let load = 1,
    lastMs: number | null = null,
    samples = 0
  return {
    budgetMs: share,
    get load() {
      return load
    },
    get lastMs() {
      return lastMs
    },
    get samples() {
      return samples
    },
    observe(reflectionMs, probeMs) {
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
