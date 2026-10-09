import { FLAG_SECTIONS, type FlagShape } from './flagSections.ts'
import { CAND_LIVE_WORDS } from './shader/levelWgsl.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'

/**
 * A CUT'S TABLES IN PARTS, past one storage binding of the device. `frames` and `worlds` split in
 * ranges of primitives, one dispatch each (`frameRanges.ts`); the tables a thread reads at any
 * index — a page's record, a queue's node, a key's canonical page, whose last use a range may stamp
 * in another's — cannot: they split in parts that every dispatch binds at once, each its own buffer
 * of at most one binding, and the kernel reads them through one accessor per table
 * (`shader/splitWgsl.ts`). A table the device holds whole is one part: the layout, the text and the
 * bindings of before. A device that cannot bind the parts at once refuses the GPU cut, and the CPU
 * cut draws (`deviceRefusal.ts`): coarser in time, never a hole.
 */

/** A table cut in parts of `per` elements each, the last holding what remains. */
export type TableSplit = { per: number; parts: number }

/** `count` elements of `bytes` each in parts one binding of `cap` bytes holds; one element past
 *  the binding stays one part per element, which the fit rule then refuses (`pastBinding`). */
export function splitTable(count: number, bytes: number, cap: number): TableSplit {
  const per = Math.max(1, Math.floor(cap / bytes))
  if (count <= per) return { per: Math.max(1, count), parts: 1 }
  return { per, parts: ceilDiv(count, per) }
}

/** First word of section `s` of a `flags` of `shape`: the kernel's `queueBase` and list bases, as
 *  `shader/splitWgsl.ts` states them in WGSL. */
export function flagSectionStart(s: number, { queueWords, candCap }: FlagShape) {
  if (s === 0) return 0
  if (s === 1) return queueWords
  if (s === 2) return queueWords + 2 * candCap
  return (s - 2) * queueWords + CAND_LIVE_WORDS * candCap
}

/** Words of section `s`: a queue's, a list's, or the last uses, a word a content key. */
function sectionWords(s: number, shape: FlagShape) {
  if (s === 1) return 2 * shape.candCap
  if (s === 2) return 3 * shape.candCap
  return s === FLAG_SECTIONS - 1 ? shape.keyCount : shape.queueWords
}

/** The sections a `flags` of `shape` starts parts at, first fit: each part as many whole sections
 *  as one binding of `cap` bytes holds. A section is never cut, so each list and the drawn log lie
 *  in one part; one past the binding is a part of its own, which the fit rule refuses. */
export function flagCuts(shape: FlagShape, cap: number) {
  const cuts: number[] = []
  let words = sectionWords(0, shape)
  for (let s = 1; s < FLAG_SECTIONS; s++) {
    const own = sectionWords(s, shape)
    if ((words + own) * 4 > cap) {
      cuts.push(s)
      words = own
    } else words += own
  }
  return cuts
}
