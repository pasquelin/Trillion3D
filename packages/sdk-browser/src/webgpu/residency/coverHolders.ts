import type { PageRec } from '../../page/selection/types.ts'
import { createDenseKeySet } from '../cut/denseKeys.ts'
import type { createKeyUnion } from '../cut/keyUnion.ts'

type Union = ReturnType<typeof createKeyUnion>

/** Each listed page's rank and its place in the list (`byRank`), grown as the lists do: one rank
 *  read a page, never two a comparison. */
let rankScratch = new Float64Array(64),
  orderScratch = new Uint32Array(64)

/** The first `limit` of `pages` by `rank`, the lowest first, ties in their order. */
function byRank(pages: readonly PageRec[], rank: (page: PageRec) => number, limit: number) {
  const n = pages.length
  if (rankScratch.length < n) {
    rankScratch = new Float64Array(2 * n)
    orderScratch = new Uint32Array(2 * n)
  }
  const ranks = rankScratch
  for (let i = 0; i < n; i++) {
    ranks[i] = rank(pages[i])
    orderScratch[i] = i
  }
  const order = orderScratch.subarray(0, n).sort((a, b) => ranks[a] - ranks[b] || a - b)
  const out: PageRec[] = new Array(Math.min(n, limit))
  for (let k = 0; k < out.length; k++) out[k] = pages[order[k]]
  return out
}

/**
 * THE ROOT COVER, COUNTED BY ITS HOLDERS. `holders` says per key how many hold it: the session its
 * roots from open, and each held cell the roots it alone needs. A page joins the cover with its
 * first holder — kept, out of what the cut asks the budget for (`requested.cover`), counted in
 * `covered` — and leaves it with its last. The session's pages are loaded at open
 * (`../frame/bootstrap.ts`); a page a later holder brings is `missing` until the pool holds it,
 * and the queue loads it before any other (`residentEnsurer.ts`).
 */
export function createCoverHolders(options: {
  holders: Uint8Array
  keyOf: (page: PageRec) => number
  requested: Union
  keep: Union
  /** A key joined the cover, or left it: the pins follow (`pinUpdater.ts`). */
  joined: (key: number) => void
  left: (key: number) => void
}) {
  const { holders, keyOf, requested, keep } = options
  /** Keys with a holder: the pool slots the cover takes, a key an address. */
  let covered = 0
  for (let key = 0; key < holders.length; key++) if (holders[key]) covered++
  const missingPages: PageRec[] = []
  const lacking = createDenseKeySet(missingPages)
  /** `page` gains a holder: with its first, it joins the cover — kept, out of what the budget
   *  weighs, missing until the pool holds it. */
  const join = (page: PageRec) => {
    const key = keyOf(page)
    if (holders[key]++ > 0) return false
    covered++
    keep.retain(key, page)
    requested.cover(key, true, page)
    lacking.add(key, page)
    options.joined(key)
    return true
  }
  /** `page` loses a holder: with its last, it leaves the cover. */
  const leave = (page: PageRec) => {
    const key = keyOf(page)
    if (!holders[key] || --holders[key] > 0) return false
    covered--
    requested.cover(key, false, page)
    keep.release(key)
    lacking.remove(key)
    options.left(key)
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
    /** The pages a later holder brought into the cover that the pool lacks, as `holds` says, at
     *  most `limit` — the slots that could take them —, the first by `rank` when given (the lowest
     *  first): those it holds leave the list. A list of its own, read across the awaits of a
     *  burst. */
    missing(
      holds: (page: PageRec) => boolean,
      limit = Infinity,
      rank?: (page: PageRec) => number,
    ): readonly PageRec[] {
      if (lacking.count === 0) return none
      const out: PageRec[] = []
      for (let i = lacking.count - 1; i >= 0 && (rank || out.length < limit); i--)
        if (holds(missingPages[i])) lacking.remove(lacking.list[i])
        else out.push(missingPages[i])
      return rank ? byRank(out, rank, limit) : out
    },
    /** How many pages a later holder brought that the pool may lack still. */
    lacking: () => lacking.count,
    /** The pool slots the cover takes now. */
    get covered() {
      return covered
    },
    get byteLength() {
      return lacking.byteLength
    },
  }
}
