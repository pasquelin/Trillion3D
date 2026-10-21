import type { PageRec } from '../selection/types.ts'
import { createSparseInts } from '../cut/sparseInts.ts'
import { byteLengths } from '../../../../math/src/sequence/byteLengths.ts'

export type StreamedPages = ReturnType<typeof createStreamedPages>

/**
 * THE STREAMING PAGES THE STREAMING HOLDS (`./pageUnits.ts`, keyed by their number), the root
 * cover apart: each it started — its bytes on their way (`pending`) — or holds resident, in the
 * order of its last use, the least recent first, and for each the started or resident streaming
 * pages that depend on it (`dependents`): one a streaming page depends on is never given up while
 * that one stays.
 *
 * A streaming page joins the order's end when the streaming starts it (`start`), and moves to the
 * end again each update a request names it (`touch`); it leaves the order when its slot is promised
 * to one started — the victim, drawn until that one is written over it — or when it leaves the
 * pool another way (`drop`). A victim whose taker never came goes back to the order's head
 * (`restore`). Every move is O(1): each listed key's neighbours are held in two sparse maps, sized
 * by the pool, never the catalogue (`../cut/sparseInts.ts`).
 */
export function createStreamedPages() {
  /** Each listed key's neighbours: the previous key plus 2, 1 for the first; the next key plus 1,
   *  0 for the last. */
  const before = createSparseInts(),
    after = createSparseInts()
  /** Each listed key's record: what the pages it depends on are read from. */
  const records = new Map<number, PageRec>()
  /** Each key started whose page has not landed: the rank it was started at, plus one. */
  const started = createSparseInts()
  /** Started or resident pages depending on each key. */
  const dependents = createSparseInts()
  let first = -1,
    last = -1,
    starts = 0,
    revision = 0
  const listed = (key: number) => before.get(key) !== 0
  const unlink = (key: number) => {
    const previous = before.get(key) - 2,
      next = after.get(key) - 1
    before.set(key, 0)
    after.set(key, 0)
    if (previous >= 0) after.set(previous, next + 1)
    else first = next
    if (next >= 0) before.set(next, previous + 2)
    else last = previous
  }
  const append = (key: number) => {
    before.set(key, last + 2)
    if (last >= 0) after.set(last, key + 1)
    else first = key
    last = key
  }
  const prepend = (key: number) => {
    before.set(key, 1)
    if (first >= 0) {
      after.set(key, first + 1)
      before.set(first, key + 2)
    } else last = key
    first = key
  }
  return {
    /** Whether the streaming holds `key`: started, or resident. */
    has: listed,
    /** Whether `key` was started and its page has not landed yet. */
    pending: (key: number) => started.get(key) !== 0,
    /** The rank `key` was started at — the earlier, the lower —, -1 for a page not pending: the
     *  order the host fetches what the pool waits on (`../cut/adoption/pending.ts`). */
    rankOf: (key: number) => started.get(key) - 1,
    /** Advanced by every start: `rankOf` may answer otherwise. */
    get revision() {
      return revision
    },
    /** The least recently used key, -1 for none. */
    get first() {
      return first
    },
    /** The key used next after `key`, -1 past the last. */
    next: (key: number) => after.get(key) - 1,
    /** Each listed key's record. */
    recordOf: (key: number) => records.get(key),
    /** Keys the streaming holds. */
    get size() {
      return records.size
    },
    /** `key`, `page`'s, started: pending, at the order's end. */
    start(key: number, page: PageRec) {
      records.set(key, page)
      append(key)
      started.set(key, ++starts)
      revision++
    },
    /** `key`'s page landed: resident, where the order holds it. */
    landed: (key: number) => void started.set(key, 0),
    /** `key` used by this update: at the order's end. */
    touch(key: number) {
      unlink(key)
      append(key)
    },
    /** `key` leaves: a victim, a page that left the pool, a start whose page never came. Returns
     *  its record, `undefined` for a key the streaming did not hold. */
    drop(key: number) {
      const page = records.get(key)
      if (!page) return undefined
      unlink(key)
      records.delete(key)
      started.set(key, 0)
      return page
    },
    /** A victim whose page never came, still resident: back at the order's head, the first to
     *  give up again. */
    restore(key: number, page: PageRec) {
      records.set(key, page)
      prepend(key)
    },
    /** `by` more pages depend on `key` (fewer when negative). */
    depend: (key: number, by: number) => void dependents.add(key, by),
    /** How many started or resident pages depend on `key`. */
    dependentsOf: (key: number) => dependents.get(key),
    /** Every key let go at once: a pool replaced (`./queue.ts`). */
    clear() {
      before.clear()
      after.clear()
      records.clear()
      started.clear()
      dependents.clear()
      first = last = -1
      revision++
    },
    /** Bytes of its tables, bounded by the pool. */
    get byteLength() {
      return byteLengths(before, after, started, dependents) + records.size * 16
    },
  }
}
