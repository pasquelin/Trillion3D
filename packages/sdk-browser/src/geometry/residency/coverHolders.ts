import type { PageRec } from '../selection/types.ts'
import { createDenseKeySet } from '../cut/adoption/denseKeys.ts'
import type { createKeyUnion } from '../cut/adoption/keyUnion.ts'
import { createSparseInts } from '../cut/sparseInts.ts'

type Union = ReturnType<typeof createKeyUnion>

/** Each listed page's rank and its place in the list (`byRank`), grown as the lists do: one rank
 *  read a page, never two a comparison. */
let rankScratch = new Float64Array(64),
  orderScratch = new Uint32Array(64)

/** Sorts `pages` in place by `rank`, the lowest first, ties in their order, and returns it: the
 *  cover's pages a later holder brought (`missing`), the pages the host fetches
 *  (`../cut/adoption/pending.ts`). Nothing is allocated past the scratch: the order is sorted in
 *  `orderScratch`, then applied to `pages` cycle by cycle. */
export function byRank(pages: PageRec[], rank: (page: PageRec) => number) {
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
  // `order[k]` is where the page that belongs at `k` stands now.
  const order = orderScratch.subarray(0, n).sort((a, b) => ranks[a] - ranks[b] || a - b)
  for (let k = 0; k < n; k++) {
    if (order[k] === k) continue
    const first = pages[k]
    let at = k
    for (let from = order[at]; from !== k; from = order[at]) {
      pages[at] = pages[from]
      order[at] = at
      at = from
    }
    pages[at] = first
    order[at] = at
  }
  return pages
}

/**
 * THE ROOT COVER, COUNTED BY ITS HOLDERS. `holders` says per key how many hold it: the session its
 * roots from open, and each held cell the roots it alone needs. A page joins the cover with its
 * first holder — kept, out of what the cut asks the budget for (`requested.cover`), its streaming
 * page counted in `covered` — and leaves it with its last. The session's pages are loaded at open
 * (`../../frame/loop/bootstrap.ts`); a page a later holder brings is `missing` until the pool holds it,
 * and each update loads it before any page it streams (`queue.ts`).
 */
export function createCoverHolders(options: {
  holders: Uint8Array
  keyOf: (page: PageRec) => number
  /** The streaming page of a key (`pageUnits.ts`): the unit a pool slot holds. */
  unitOf: (key: number) => number
  requested: Union
  keep: Union
  /** A key joined the cover, or left it: the pins follow (`pinUpdater.ts`). */
  joined: (key: number) => void
  left: (key: number) => void
}) {
  const { holders, keyOf, unitOf, requested, keep } = options
  /** Keys with a holder in each streaming page, and the streaming pages holding one: the pool
   *  slots the cover takes. */
  const coveredKeys = createSparseInts()
  let covered = 0
  const count = (key: number, by: number) => {
    const held = coveredKeys.add(unitOf(key), by)
    if (held === (by > 0 ? 1 : 0)) covered += by
  }
  for (let key = 0; key < holders.length; key++) if (holders[key]) count(key, 1)
  const missingPages: PageRec[] = []
  const lacking = createDenseKeySet(missingPages)
  /** `page` gains a holder: with its first, it joins the cover — kept, out of what the budget
   *  weighs, missing until the pool holds it. */
  const join = (page: PageRec) => {
    const key = keyOf(page)
    if (holders[key]++ > 0) return false
    count(key, 1)
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
    count(key, -1)
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
    /** The pages a later holder brought into the cover that the pool lacks, as `holds` says, by
     *  `rank` when given (the lowest first): those it holds leave the list. A list of its own,
     *  read across the loads it starts. */
    missing(
      holds: (page: PageRec) => boolean,
      rank?: (page: PageRec) => number,
    ): readonly PageRec[] {
      if (lacking.count === 0) return none
      const out: PageRec[] = []
      for (let i = lacking.count - 1; i >= 0; i--)
        if (holds(missingPages[i])) lacking.remove(lacking.list[i])
        else out.push(missingPages[i])
      return rank ? byRank(out, rank) : out
    },
    /** The pool slots the cover takes now: its streaming pages. */
    get covered() {
      return covered
    },
    get byteLength() {
      return lacking.byteLength + coveredKeys.byteLength
    },
  }
}
