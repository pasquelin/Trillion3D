import { PAGE_SECTIONS, FLAG_SECTIONS } from './flagSections.ts'
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

/** First word of section `s` of a `flags` of `queueCap` per queue over `pageCount` pages: the
 *  kernel's `queueBase` and page bases, as `shader/splitWgsl.ts` states them in WGSL. */
export function flagSectionStart(s: number, queueCap: number, pageCount: number) {
  if (s === 0) return 0
  if (s <= PAGE_SECTIONS) return queueCap + (s - 1) * pageCount
  return (s - PAGE_SECTIONS) * queueCap + PAGE_SECTIONS * pageCount
}

/** Words of section `s`: a queue's `queueCap`, or one per page. */
const sectionWords = (s: number, queueCap: number, pageCount: number) =>
  (s >= 1 && s <= PAGE_SECTIONS) || s === FLAG_SECTIONS - 1 ? pageCount : queueCap

/** The sections a `flags` of `queueCap` per queue over `pageCount` pages starts parts at, first
 *  fit: each part as many whole sections as one binding of `cap` bytes holds. A section is never
 *  cut, so the draw mask and the drawn log each lie in one part; one past the binding is a part of
 *  its own, which the fit rule refuses. */
export function flagCuts(queueCap: number, pageCount: number, cap: number) {
  const cuts: number[] = []
  let words = sectionWords(0, queueCap, pageCount)
  for (let s = 1; s < FLAG_SECTIONS; s++) {
    const own = sectionWords(s, queueCap, pageCount)
    if ((words + own) * 4 > cap) {
      cuts.push(s)
      words = own
    } else words += own
  }
  return cuts
}
