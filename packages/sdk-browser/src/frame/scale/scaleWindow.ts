import { DEFAULT_CUT_EDGE_SCALE_MIN_PERCENT } from '../../../../sdk-core/src/contracts/cutOptions.ts'
import { DYNAMIC_RESOLUTION_RULES } from '../../../../sdk-core/src/contracts/dynamicResolutionOptions.ts'
import { resolveSettings } from '../../../../sdk-core/src/contracts/settingRules.ts'
import type { RenderScaleBounds } from './renderScaleOption.ts'
import { createDynamicResolution, resetDynamicResolution } from './dynamicResolution.ts'

/**
 * The state of the render scale controller (`scaleControl.ts`), fields of one object stored in
 * place: a closure's number is boxed at each write. `s` the dynamic resolution's fraction, `max`
 * the render targets' upper bound under the memory cap; `dynamic` the dynamic resolution history
 * the scale follows (`dynamicResolution.ts`), which fits the cut's edge scale beside it: `edge`
 * its fraction, 1 while `edgeBudgetMs` is not above 0, `edgeMin` the lowest; `rules` the settings
 * the heuristic reads, written in place by the frame (`../prepare/timing.ts`), `cpuMs` the CPU
 * time of the engine's last image; `at` the refresh the history was learnt on; the images drawn
 * and the one the last GPU time came at; the display frames the loop held to measure the refresh
 * on, and whether the last one was; whether the GPU timer answers.
 */
export function createScaleWindow(bounds: RenderScaleBounds) {
  return {
    bounds,
    s: 1,
    max: bounds.max,
    dynamic: createDynamicResolution(),
    edge: 1,
    edgeBudgetMs: 0,
    edgeMin: DEFAULT_CUT_EDGE_SCALE_MIN_PERCENT / 100,
    rules: resolveSettings(DYNAMIC_RESOLUTION_RULES, {}),
    cpuMs: 0,
    at: Number.NaN,
    images: 0,
    timedAt: 0,
    held: 0,
    holding: false,
    timed: false,
  }
}

export type ScaleWindow = ReturnType<typeof createScaleWindow>

/**
 * The cut's edge scale as the frame reads it (`ScaleControl.edge`): `now` its fraction; `budgetMs`
 * the budget the cut was last given; `ask(budgetMs, percent)` the budget given, with the lowest
 * fraction it takes the screen error to, in percent: the fraction the cut divides its threshold
 * by — 1 for a budget of 0 or less, what was learnt kept.
 */
export const edgeOf = (w: ScaleWindow) => ({
  get now() {
    return w.edge
  },
  get budgetMs() {
    return w.edgeBudgetMs
  },
  ask(budgetMs: number, percent: number) {
    w.edgeBudgetMs = budgetMs
    w.edgeMin = percent / 100
    return budgetMs > 0 ? w.edge : 1
  },
})

/** The interactive loop held the display frame that began: it draws nothing. */
export function holdFrame(w: ScaleWindow) {
  w.held++
  w.holding = true
}

/** What was learnt goes: another display, refresh, bounds or frame cap, or the GPU timer fell
 *  silent. */
export const forgetHistory = (w: ScaleWindow) => resetDynamicResolution(w.dynamic, w)
