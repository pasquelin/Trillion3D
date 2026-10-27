import { nanosecondsToMs, type GpuTimingSample } from './types.ts'
import type { ImageSpan } from './timeline.ts'
import { addedLength } from '../../../../math/src/sequence/span.ts'

// The span arithmetic of an image's timestamps (`sample.ts`): each pass's own share, the time a set
// of spans covers, and their envelope. Spans the device overlaps count once.

/** A pass with a valid pair, its beginning and end on the device timeline, ns; `pass` takes its own
 *  share and its place on the image's timeline, ms. */
export type TimedPass = {
  pass: { ownMs: number; beginMs: number; endMs: number }
  begin: bigint
  end: bigint
}

/**
 * Sets each timed pass's own share of the image, ms: its span less what a pass the queue ran before
 * it already covered (#1279). A device that overlaps passes reports each one's whole span, so their
 * durations add up past the image; these shares count an overlap once, on the pass submitted first,
 * and add up to the time the timed passes cover. `timed` is in the queue's order — the parts as the
 * image submits them, each one's passes as encoded —, never sorted by beginning: a tiled GPU
 * begins a render pass at its vertex stage, ahead of a compute pass submitted before it, whose
 * whole span it would then take.
 */
export function setOwnShares(timed: TimedPass[]) {
  let covered = 0n
  for (const { pass, begin, end } of timed) {
    pass.ownMs = nanosecondsToMs(Number(addedLength(begin, end, covered, 0n)))
    if (end > covered) covered = end
  }
}

/** Sets each timed pass's place on its image's timeline, ms from `origin`, the image's earliest
 *  beginning. */
export function placePasses(timed: TimedPass[], origin: bigint) {
  for (const { pass, begin, end } of timed) {
    pass.beginMs = nanosecondsToMs(Number(begin - origin))
    pass.endMs = nanosecondsToMs(Number(end - origin))
  }
}

/**
 * The window of the passes of `sample` that `picked` names, ms: from the earliest beginning to the
 * latest end of them, the passes between and the gaps among them included. 0 when none ran, null
 * for a missing or truncated sample, or when a picked pass has no usable pair: a window over some
 * of its passes would pass for a measurement (the rule of `gpuTotalsBy`).
 */
export function passWindowMs(
  sample: Pick<GpuTimingSample, 'passes' | 'truncated'> | null | undefined,
  picked: (name: string) => boolean,
) {
  if (!sample || sample.truncated) return null
  let begin = Infinity,
    end = -Infinity
  for (const pass of sample.passes) {
    if (!picked(pass.name)) continue
    if (pass.beginMs === undefined || pass.endMs === undefined) return null
    begin = Math.min(begin, pass.beginMs)
    end = Math.max(end, pass.endMs)
  }
  return end >= begin ? end - begin : 0
}

/** The earliest beginning to the latest end of `spans`, or `null` for none. */
export function envelope(spans: ImageSpan[]): ImageSpan | null {
  let image: ImageSpan | null = null
  for (const { beginNs, endNs } of spans)
    image = image
      ? {
          beginNs: beginNs < image.beginNs ? beginNs : image.beginNs,
          endNs: endNs > image.endNs ? endNs : image.endNs,
        }
      : { beginNs, endNs }
  return image
}
