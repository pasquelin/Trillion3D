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
 * its fraction, 1 while `edgeBudgetMs` is not above 0, `edgeMin` the lowest, and the shadow raster's:
 * `vsm` its fraction, 1 while `vsmBudgetMs` is not above 0; `rules` the settings
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
    vsm: 1,
    vsmBudgetMs: 0,
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
 * A linear budget as its asker reads it: `now` its fraction; `budgetMs` the budget last given;
 * `ask(budgetMs, percent)` the budget given and the fraction to work to: 1 for a budget of 0 or less,
 * what was learnt kept. A budget with a lowest fraction takes it in percent (`noted`).
 */
const budgetOf = (w: ScaleWindow, name: 'edge' | 'vsm', noted?: (percent: number) => void) => {
  const budget = `${name}BudgetMs` as const
  return {
    get now() {
      return w[name]
    },
    get budgetMs() {
      return w[budget]
    },
    ask(budgetMs: number, percent?: number) {
      w[budget] = budgetMs
      if (percent !== undefined) noted?.(percent)
      return budgetMs > 0 ? w[name] : 1
    },
  }
}

/** The cut's edge scale as the frame reads it (`ScaleControl.edge`); `ask(budgetMs, percent)` also gives
 *  the lowest fraction it takes the screen error to, in percent. */
export const edgeOf = (w: ScaleWindow) =>
  budgetOf(w, 'edge', (percent) => void (w.edgeMin = percent / 100))

/** The shadow raster's budget as the shadows read it (`ScaleControl.vsm`): the fraction of its maps'
 *  compute they keep, fitted to `shadowDynamicResolutionTimeBudgetMs`. */
export const vsmOf = (w: ScaleWindow) => budgetOf(w, 'vsm')

/** The interactive loop held the display frame that began: it draws nothing. */
export function holdFrame(w: ScaleWindow) {
  w.held++
  w.holding = true
}

/** What was learnt goes: another display, refresh, bounds or frame cap, or the GPU timer fell
 *  silent. */
export const forgetHistory = (w: ScaleWindow) => resetDynamicResolution(w.dynamic, w)
