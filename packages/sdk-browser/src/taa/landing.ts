import type { TaaFrameState } from './frameState.ts'
import { HISTORY_LAWS } from './historyWgsl.ts'
import { ceilDiv } from '../../../math/src/scalar/integers.ts'

/** The history describes no image the view can still show — a view cut, new targets, the pass
 *  switched: dropped, and the jitter back to phase zero, so the new history starts on the
 *  sequence's first, best spread samples. */
export function dropTaaHistory(frame: TaaFrameState | undefined) {
  if (!frame) return
  frame.hasHistory = false
  frame.sample = 0
  frame.accumulated = 0
}

/**
 * Whether a still view's history is whole and may be held (`holdWebgpuFrame`): images drawn
 * `render` pixels wide and shown `display` wide reach each display pixel `phases · (render /
 * display)²` times a cycle of the jitter's phases, so it holds its most samples
 * (`HISTORY_LAWS`) after `⌈samples / that⌉` whole cycles; held at
 * the end of one (`sample` back to zero), the history averages every phase alike. Its validity is
 * then full on every pixel the image keeps, and a further image of the same view only cycles the
 * jitter over the same samples.
 */
export function taaConverged(frame: TaaFrameState, render: number, display: number) {
  if (!frame.hasHistory || frame.sample !== 0) return false
  const { samples } = HISTORY_LAWS
  const perCycle = frame.phases * Math.min(1, (render / display) ** 2)
  return frame.accumulated >= frame.phases * ceilDiv(samples, perCycle)
}
