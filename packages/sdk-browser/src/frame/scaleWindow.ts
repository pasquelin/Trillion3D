import type { RenderScaleBounds } from './renderScaleOption.ts'
import { createDynamicResolution, resetDynamicResolution } from './dynamicResolution.ts'

/**
 * The state of the render scale controller (`scaleControl.ts`), fields of one object stored in
 * place: a closure's number is boxed at each write. `s` the dynamic resolution's fraction, `max`
 * the render targets' upper bound under the memory cap; `dynamic` the dynamic resolution history
 * the scale follows (`dynamicResolution.ts`); `at` the refresh
 * the history was learnt on; the images drawn and the one the last GPU time came at; the display
 * frames the loop held to measure the refresh on, and whether the last one was; whether the GPU
 * timer answers.
 */
export function createScaleWindow(bounds: RenderScaleBounds) {
  return {
    bounds,
    s: 1,
    max: bounds.max,
    dynamic: createDynamicResolution(),
    at: Number.NaN,
    images: 0,
    timedAt: 0,
    held: 0,
    holding: false,
    timed: false,
  }
}

export type ScaleWindow = ReturnType<typeof createScaleWindow>

/** The interactive loop held the display frame that began: it draws nothing. */
export function holdFrame(w: ScaleWindow) {
  w.held++
  w.holding = true
}

/** What was learnt goes: another display, refresh, bounds or frame cap, or the GPU timer fell
 *  silent. */
export const forgetHistory = (w: ScaleWindow) => resetDynamicResolution(w.dynamic, w)
