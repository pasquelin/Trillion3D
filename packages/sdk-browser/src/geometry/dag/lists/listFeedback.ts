import { LIST_SETTINGS, type CutListCaps } from './cutListCaps.ts'

/**
 * THE CUT'S OVERFLOW WARNINGS, kept as the reference keeps them. A cut past one of its lists' caps
 * drops what is past it — the nodes and their subtrees, the candidate clusters, the clusters drawn —
 * and draws what fits (`../shader/levelWgsl.ts`, `../shader/visibleWgsl.ts`); its readback brings
 * back what it asked of each list, counted past the cap (`ListPeaks`). Each list keeps its
 * HIGH-WATER MARK, the most any readback asked of it, under its cap or past it; a readback past the
 * cap whose peak raises the mark is said once, by its list, its peak over its cap, the mark and the
 * setting that raises the cap. Nothing else follows: the cut is never cut again for it, its
 * threshold never moved.
 */

/** What one cut asked of its lists, each the most one pass asked of it, as the reference reads its
 *  peaks: the nodes a pass opened, the candidate clusters it listed and the clusters it drew
 *  (`../shader/finishWgsl.ts`, `../uniforms.ts`, `parseDagOutput`). */
export type ListPeaks = CutListCaps

/** What a list's overflow says: the list, the peak the readback asked, the cap, the mark now and
 *  the setting that raises the cap (`LIST_SETTINGS`). */
export type ListOverflow = {
  list: keyof CutListCaps
  peak: number
  cap: number
  highWater: number
  setting: (typeof LIST_SETTINGS)[keyof CutListCaps]['field']
}

/** The words a list's overflow is said in. */
export const listOverflowMessage = ({ list, peak, cap, highWater, setting }: ListOverflow) =>
  `The cut's ${list} list overflowed: ${peak} / ${cap}, its high-water mark ${highWater}. ` +
  `Raise ${setting} to draw what it dropped.`

/** The marks of one cut's lists, each readback's peaks noted against the caps in effect
 *  (`note`); `say` is told each overflow that raises its list's mark. */
export function createListFeedback(say: (overflow: ListOverflow) => void) {
  const highWater: CutListCaps = { nodes: 0, candidates: 0, visible: 0 }
  return (peaks: ListPeaks, caps: CutListCaps) => {
    for (const list of Object.keys(LIST_SETTINGS) as (keyof CutListCaps)[]) {
      const peak = peaks[list],
        cap = caps[list],
        risen = peak > cap && peak > highWater[list]
      highWater[list] = Math.max(highWater[list], peak)
      if (risen)
        say({ list, peak, cap, highWater: highWater[list], setting: LIST_SETTINGS[list].field })
    }
  }
}

/** The marks a cut keeps (`createListFeedback`). */
export type ListFeedback = ReturnType<typeof createListFeedback>
