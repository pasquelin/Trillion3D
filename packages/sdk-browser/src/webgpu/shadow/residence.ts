/** `to` holding the first `kept` values of `from`. */
function widen<T extends Uint32Array | Uint8Array | Int32Array>(from: T, to: T, kept: number) {
  if (kept) to.set(from.subarray(0, kept))
  return to
}

/** Per-page values compared plan to plan, reduced by `flagOf` to what a light cut sees. */
function createResidenceTracker(flagOf: (value: number) => number) {
  let seen = new Uint32Array(0),
    marked = new Uint8Array(0),
    pending = new Int32Array(0),
    count = 0
  return {
    /** `pages` counts the catalogue: one that grew in place keeps what was seen and noted. */
    note(page: number, pages: number) {
      if (seen.length !== pages) {
        const kept = seen.length < pages ? seen.length : 0
        seen = widen(seen, new Uint32Array(pages), kept)
        marked = widen(marked, new Uint8Array(pages), kept)
        pending = widen(pending, new Int32Array(pages), kept && count)
        if (!kept) count = 0
      }
      if (page < 0 || marked[page]) return
      marked[page] = 1
      pending[count++] = page
    },
    flush(values: ArrayLike<number>, changed?: (page: number) => void) {
      for (let i = 0; i < count; i++) {
        const page = pending[i],
          flag = flagOf(values[page])
        marked[page] = 0
        if (flag === seen[page]) continue
        seen[page] = flag
        changed?.(page)
      }
      count = 0
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
    flush(rowFlags: ArrayLike<number>, changed: (page: number) => void) {
      rows.flush(rowFlags, changed)
    },
  }
}
