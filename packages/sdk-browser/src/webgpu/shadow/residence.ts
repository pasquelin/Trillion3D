/** Per-page values compared plan to plan, reduced by `flagOf` to what a light cut sees. */
function createResidenceTracker(flagOf: (value: number) => number) {
  let seen = new Uint32Array(0),
    marked = new Uint8Array(0),
    pending = new Int32Array(0),
    count = 0;
  return {
    note(page: number, pages: number) {
      if (seen.length !== pages) {
        seen = new Uint32Array(pages);
        marked = new Uint8Array(pages);
        pending = new Int32Array(pages);
        count = 0;
      }
      if (page < 0 || marked[page]) return;
      marked[page] = 1;
      pending[count++] = page;
    },
    flush(values: ArrayLike<number>, changed?: (page: number) => void) {
      for (let i = 0; i < count; i++) {
        const page = pending[i],
          flag = flagOf(values[page]);
        marked[page] = 0;
        if (flag === seen[page]) continue;
        seen[page] = flag;
        changed?.(page);
      }
      count = 0;
    },
  };
}

/**
 * WHAT THE LIGHT CUTS SEE OF RESIDENCY, frame to frame. A page's residency flag drops and rises
 * again whenever its row is rewritten — a pose moves anywhere in the scene and every row follows
 * the new table epoch —, and the flags flip back before the next plan reads them. Declaring each
 * flip a change of representation staled every shadow page under every cluster of the scene on
 * every frame an object moved. What changes a light cut's casters is the flag as the next plan
 * sees it against the one the last plan saw: only those pages are declared (`noteResidenceChange`).
 *
 * Each cut reads its own residency: the GPU cut a page's row flag, the CPU cut the pool itself —
 * a page's slot, for which the CPU cut writes no flag. A GPU frame compares the row flags and
 * keeps the pool's current without declaring it; a CPU frame compares the pool, and leaves the row
 * flags, which it does not move, to the next GPU frame.
 */
export function createShadowResidence() {
  const rows = createResidenceTracker((flag) => flag),
    pool = createResidenceTracker((words) => (words >= 0 ? 1 : 0));
  return {
    /** Page `page`'s row flag flipped: it is compared at the next GPU plan. */
    noteRow: rows.note,
    /** Page `page`'s pool slot changed: it is compared at the next plan. */
    notePool: pool.note,
    /** Hands every noted page whose residency, as this frame's cut reads it, differs from what
     *  the last plan of that cut saw to `changed`. */
    flush(
      rowFlags: ArrayLike<number>,
      poolWords: ArrayLike<number>,
      gpuCut: boolean,
      changed: (page: number) => void,
    ) {
      if (gpuCut) rows.flush(rowFlags, changed);
      pool.flush(poolWords, gpuCut ? undefined : changed);
    },
  };
}
