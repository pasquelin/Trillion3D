import type { TaaFrameState } from './frameState.ts'
import { historySamples } from './historyWgsl.ts'
import { TEMPORAL_DEFAULTS } from '../../../../sdk-core/src/contracts/temporalOptions.ts'
import { dropFrames } from './historyFrames.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { imagesToForget } from '../../lighting/bounce/screen/historyReady.ts'

/** The history describes no image the view can still show — a view cut, new targets, the pass
 *  switched: dropped, and the jitter back to phase zero, so the new history starts on the
 *  sequence's first, best spread samples. */
export function dropTaaHistory(frame: TaaFrameState | undefined) {
  if (!frame) return
  frame.hasHistory = false
  frame.sample = 0
  frame.accumulated = 0
  dropFrames(frame.ring)
}

/**
 * Whether a still view's history is whole and may be held (`holdWebgpuFrame`): images drawn
 * `render` pixels wide reach each pixel of a history `display · historyScale` wide `phases ·
 * (render / history)²` times a cycle of the jitter's phases, so it holds its most samples
 * (`historySamples` of the history's scale, `maxSamples` a display pixel's: `temporalHistorySampleCount`)
 * after `⌈samples / that⌉` whole cycles; held at
 * the end of one (`sample` back to zero), the history averages every phase alike. Its validity is
 * then full on every pixel the image keeps, and a further image of the same view only cycles the
 * jitter over the same samples.
 */
export function taaConverged(
  frame: TaaFrameState,
  render: number,
  display: number,
  maxSamples = TEMPORAL_DEFAULTS.temporalHistorySampleCount,
) {
  if (!frame.hasHistory || frame.sample !== 0) return false
  return (
    frame.accumulated >=
    historyImages(frame, render, display, historySamples(frame.historyScale, maxSamples))
  )
}

/** The images a history that followed a change takes to forget the view before it, under one display
 *  step, as the other histories do (`imagesToForget`). A view held sooner keeps a residue of the view
 *  before, which a world opened on the view does not have. */
export const taaForgettingImages = (
  frame: TaaFrameState,
  render: number,
  display: number,
  maxSamples = TEMPORAL_DEFAULTS.temporalHistorySampleCount,
) =>
  historyImages(
    frame,
    render,
    display,
    imagesToForget(historySamples(frame.historyScale, maxSamples)),
  )

/** The images, in whole cycles of the jitter's phases, that blend `hits` samples into a history pixel:
 *  a cycle reaches it `phases` times, fewer where the history is finer than the render. */
function historyImages(frame: TaaFrameState, render: number, display: number, hits: number) {
  const perCycle = frame.phases * Math.min(1, (render / (display * frame.historyScale)) ** 2)
  return frame.phases * ceilDiv(hits, perCycle)
}
