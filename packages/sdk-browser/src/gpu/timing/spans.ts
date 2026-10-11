import { nanosecondsToMs } from './types.ts'
import type { ImageSpan } from './timeline.ts'
import { addedLength } from '../../../../math/src/sequence/span.ts'

// The span arithmetic of an image's timestamps (`sample.ts`): each pass's own share, the time a set
// of spans covers, and their envelope. Spans the device overlaps count once.

/**
 * Sets each timed pass's own share of the image, ms: its span less what a pass the queue ran before
 * it already covered (#1279). A device that overlaps passes reports each one's whole span, so their
 * durations add up past the image; these shares count an overlap once, on the pass submitted first,
 * and add up to the time the timed passes cover. `timed` is in the queue's order — the parts as the
 * image submits them, each one's passes as encoded —, never sorted by beginning: a tiled GPU
 * begins a render pass at its vertex stage, ahead of a compute pass submitted before it, whose
 * whole span it would then take.
 */
export function setOwnShares(timed: { pass: { ownMs: number }; begin: bigint; end: bigint }[]) {
  let covered = 0n
  for (const { pass, begin, end } of timed) {
    pass.ownMs = nanosecondsToMs(Number(addedLength(begin, end, covered, 0n)))
    if (end > covered) covered = end
  }
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
