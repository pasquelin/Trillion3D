import { createSparseInts } from '../../page/cut/sparseInts.ts'
import { createDenseKeySet } from '../cut/denseKeys.ts'
import type { PageResidency } from '../../gpu/core/selection.ts'

/** Per-page values compared plan to plan, reduced by `flagOf` to what a light cut sees: held for
 *  the pages noted and those seen raised, never one word per page of the catalogue. */
function createResidenceTracker(flagOf: (value: number) => number) {
  const seen = createSparseInts(),
    pending = createDenseKeySet()
  return {
    note(page: number) {
      if (page >= 0) pending.add(page)
    },
    flush(values: PageResidency, changed?: (page: number) => void) {
      const { list, count } = pending
      for (let i = 0; i < count; i++) {
        const page = list[i],
          flag = flagOf(values.flag(page))
        if (flag === seen.get(page)) continue
        seen.set(page, flag)
        changed?.(page)
      }
      pending.clear()
    },
  }
}

/**
 * WHAT THE LIGHT CUTS SEE OF RESIDENCY, frame to frame. A page's residency flag drops and rises
 * again whenever its row is rewritten — a pose moves anywhere in the scene and every row follows
 * the new table epoch —, and the flags flip back before the next plan reads them. Declaring each
 * flip a change of representation staled every shadow page under every cluster of the scene on
 * every frame an object moved. What changes a light cut's casters is the flag as the next plan
 * sees it against the one the last plan saw: only those pages are declared (`noteResidenceChange`).
 *
 * The cut reads a page's row flag (#1483): a flag the row cache raised or lowered since the last
 * plan is what changes a caster.
 */
export function createShadowResidence() {
  const rows = createResidenceTracker((flag) => flag)
  return {
    /** Page `page`'s row flag flipped: it is compared at the next plan. */
    noteRow: rows.note,
    /** Hands every noted page whose row flag differs from what the last plan saw to `changed`. */
    flush(rowFlags: PageResidency, changed: (page: number) => void) {
      rows.flush(rowFlags, changed)
    },
  }
}
