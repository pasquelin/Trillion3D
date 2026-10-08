import type { PageRec } from '../../page/selection/selection.ts'
import { createDenseKeySet } from '../cut/denseKeys.ts'
import type { createKeyUnion } from '../cut/keyUnion.ts'
import { pageAddress } from '../row/pageSlots.ts'

type Union = ReturnType<typeof createKeyUnion>

/**
 * THE ROOT COVER, COUNTED BY ITS HOLDERS. `holders` says per key how many hold it: the session its
 * roots from open, and each held cell the roots it alone needs. A page joins the cover with its
 * first holder — kept, out of what the cut asks the budget for (`requested.cover`), its address in
 * `urls` — and leaves it with its last. The session's pages are loaded at open
 * (`../frame/bootstrap.ts`); a page a later holder brings is `missing` until the pool holds it,
 * and the queue loads it before any other (`residentEnsurer.ts`).
 */
export function createCoverHolders(options: {
  holders: Uint8Array
  urls: Set<string>
  keyOf: (page: PageRec) => number
  requested: Union
  keep: Union
}) {
  const { holders, urls, keyOf, requested, keep } = options
  const missingPages: PageRec[] = []
  const lacking = createDenseKeySet(missingPages)
  /** `page` gains a holder: with its first, it joins the cover — kept, out of what the budget
   *  weighs, missing until the pool holds it. */
  const join = (page: PageRec) => {
    const key = keyOf(page)
    if (holders[key]++ > 0) return false
    urls.add(pageAddress(page))
    keep.retain(key, page)
    requested.cover(key, true, page)
    lacking.add(key, page)
    return true
  }
  /** `page` loses a holder: with its last, it leaves the cover. */
  const leave = (page: PageRec) => {
    const key = keyOf(page)
    if (!holders[key] || --holders[key] > 0) return false
    urls.delete(pageAddress(page))
    requested.cover(key, false, page)
    keep.release(key)
    lacking.remove(key)
    return true
  }
  /** What `missing` hands out when the pool lacks nothing: no list made a frame. */
  const none: readonly PageRec[] = []
  return {
    /** `pages` gain a holder, `held`, or lose one; true when one joined or left the cover. */
    hold(pages: readonly PageRec[], held: boolean) {
      let moved = false
      for (const page of pages) moved = (held ? join(page) : leave(page)) || moved
      return moved
    },
    /** The pages a later holder brought into the cover that the pool lacks, as `holds` says:
     *  those it holds leave the list. A list of its own, read across the awaits of a burst. */
    missing(holds: (page: PageRec) => boolean): readonly PageRec[] {
      if (lacking.count === 0) return none
      const out: PageRec[] = []
      for (let i = lacking.count - 1; i >= 0; i--)
        if (holds(missingPages[i])) lacking.remove(lacking.list[i])
        else out.push(missingPages[i])
      return out
    },
    get byteLength() {
      return lacking.byteLength
    },
  }
}
