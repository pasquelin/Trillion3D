import { FLAG_SECTIONS, type FlagShape } from './flagSections.ts'
import { CAND_LIVE_WORDS } from './shader/levelWgsl.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'

/**
 * A CUT'S TABLES IN PARTS, past one storage binding of the device. `frames` and `worlds` split in
 * ranges of primitives, one dispatch each (`frameRanges.ts`); the tables a thread reads at any
 * index — a page's record, a queue's node, a key's canonical page — cannot: they split in parts
 * that every dispatch binds at once, each its own buffer of at most one binding, and the kernel
 * reads them through one accessor per table
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
  if (s <= LISTS) return queueWords + LIST_STARTS[s - 1] * candCap
  return (s - LISTS) * queueWords + CAND_LIVE_WORDS * candCap
}

/** The section a cut keeps from one cut to the next: the drawn log of the last cut that ran whole.
 *  The others each cut writes before it reads them. */
export const JOURNAL_SECTION = 3

/** The part of a `flags` of `shape` cut at `cuts` holding section `s`, and its first word there. */
export function flagSectionPlace(cuts: readonly number[], shape: FlagShape, s: number) {
  let part = 0
  while (part < cuts.length && cuts[part] <= s) part++
  const first = part ? flagSectionStart(cuts[part - 1], shape) : 0
  return { part, word: flagSectionStart(s, shape) - first }
}

/** The lists behind queue 0, and where each starts, in words of an entry (`shader/levelWgsl.ts`):
 *  the candidates, two; the live list, three; the drawn log and the log being written, one each. */
const LIST_STARTS = [0, 2, 5, 6],
  LISTS = LIST_STARTS.length

/** Words of section `s`: a queue's or a list's. */
function sectionWords(s: number, shape: FlagShape) {
  if (s >= 1 && s <= LISTS)
    return ((LIST_STARTS[s] ?? CAND_LIVE_WORDS) - LIST_STARTS[s - 1]) * shape.candCap
  return shape.queueWords
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
