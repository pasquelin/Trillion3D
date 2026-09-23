/**
 * WHAT THE LIGHT CUTS SEE OF RESIDENCY, frame to frame. A page's residency flag drops and rises
 * again whenever its row is rewritten — a pose moves anywhere in the scene and every row follows
 * the new table epoch —, and the flags flip back before the next plan reads them. Declaring each
 * flip a change of representation staled every shadow page under every cluster of the scene on
 * every frame an object moved. What changes a light cut's casters is the flag as the next plan
 * sees it against the one the last plan saw: only those pages are declared (`noteResidenceChange`).
 */
export function createShadowResidence() {
  let seen = new Uint32Array(0),
    marked = new Uint8Array(0),
    pending = new Int32Array(0),
    count = 0;
  return {
    /** Page `page`'s flag flipped: it is compared at the next flush. */
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
    /** Hands every noted page whose flag differs from the last flush's to `changed`. */
    flush(flags: ArrayLike<number>, changed: (page: number) => void) {
      for (let i = 0; i < count; i++) {
        const page = pending[i];
        marked[page] = 0;
        if (flags[page] === seen[page]) continue;
        seen[page] = flags[page];
        changed(page);
      }
      count = 0;
    },
  };
}
