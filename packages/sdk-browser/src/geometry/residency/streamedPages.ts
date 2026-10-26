import type { PageRec } from '../selection/types.ts'
import { createSparseInts } from '../cut/sparseInts.ts'
import { joinMembers } from '../members.ts'
import { byteLengths } from '../../../../math/src/sequence/byteLengths.ts'

/** What the streamed pages keep: the order of the keys, their records and the started ones. */
interface Streamed {
  /** Each listed key's neighbours: the previous key plus 2, 1 for the first; the next key plus 1,
   *  0 for the last. */
  before: ReturnType<typeof createSparseInts>
  after: ReturnType<typeof createSparseInts>
  /** Each listed key's record: what the pages it depends on are read from. */
  records: Map<number, PageRec>
  /** Each key started whose page has not landed: the rank it was started at, plus one. */
  started: ReturnType<typeof createSparseInts>
  /** Started or resident pages depending on each key. */
  dependents: ReturnType<typeof createSparseInts>
  first: number
  last: number
  starts: number
  revision: number
}

const unlink = (s: Streamed, key: number) => {
  const previous = s.before.get(key) - 2,
    next = s.after.get(key) - 1
  s.before.set(key, 0)
  s.after.set(key, 0)
  if (previous >= 0) s.after.set(previous, next + 1)
  else s.first = next
  if (next >= 0) s.before.set(next, previous + 2)
  else s.last = previous
}

const append = (s: Streamed, key: number) => {
  s.before.set(key, s.last + 2)
  if (s.last >= 0) s.after.set(s.last, key + 1)
  else s.first = key
  s.last = key
}

const prepend = (s: Streamed, key: number) => {
  s.before.set(key, 1)
  if (s.first >= 0) {
    s.after.set(key, s.first + 1)
    s.before.set(s.first, key + 2)
  } else s.last = key
  s.first = key
}

/** The members that read the order: who is held, started, first and next. */
function streamedQueries(s: Streamed) {
  return {
    /** Whether the streaming holds `key`: started, or resident. */
    has: (key: number) => s.before.get(key) !== 0,
    /** Whether `key` was started and its page has not landed yet. */
    pending: (key: number) => s.started.get(key) !== 0,
    /** The rank `key` was started at — the earlier, the lower —, -1 for a page not pending: the
     *  order the host fetches what the pool waits on (`../cut/adoption/pending.ts`). */
    rankOf: (key: number) => s.started.get(key) - 1,
    /** Advanced by every start: `rankOf` may answer otherwise. */
    get revision() {
      return s.revision
    },
    /** The least recently used key, -1 for none. */
    get first() {
      return s.first
    },
    /** The key used next after `key`, -1 past the last. */
    next: (key: number) => s.after.get(key) - 1,
    /** Each listed key's record. */
    recordOf: (key: number) => s.records.get(key),
    /** Keys the streaming holds. */
    get size() {
      return s.records.size
    },
    /** How many started or resident pages depend on `key`. */
    dependentsOf: (key: number) => s.dependents.get(key),
    /** Bytes of its tables, bounded by the pool. */
    get byteLength() {
      return byteLengths(s.before, s.after, s.started, s.dependents) + s.records.size * 16
    },
  }
}

/** The members that move the order: starts, uses, drops and the dependents. */
function streamedMoves(s: Streamed) {
  return {
    /** `key`, `page`'s, started: pending, at the order's end. */
    start(key: number, page: PageRec) {
      s.records.set(key, page)
      append(s, key)
      s.started.set(key, ++s.starts)
      s.revision++
    },
    /** `key`'s page landed: resident, where the order holds it. */
    landed: (key: number) => void s.started.set(key, 0),
    /** `key` used by this update: at the order's end. */
    touch(key: number) {
      unlink(s, key)
      append(s, key)
    },
    /** `key` leaves: a victim, a page that left the pool, a start whose page never came. Returns
     *  its record, `undefined` for a key the streaming did not hold. */
    drop(key: number) {
      const page = s.records.get(key)
      if (!page) return undefined
      unlink(s, key)
      s.records.delete(key)
      s.started.set(key, 0)
      return page
    },
    /** A victim whose page never came, still resident: back at the order's head, the first to
     *  give up again. */
    restore(key: number, page: PageRec) {
      s.records.set(key, page)
      prepend(s, key)
    },
    /** `by` more pages depend on `key` (fewer when negative). */
    depend: (key: number, by: number) => void s.dependents.add(key, by),
    /** Every key let go at once: a pool replaced (`./queue.ts`). */
    clear() {
      s.before.clear()
      s.after.clear()
      s.records.clear()
      s.started.clear()
      s.dependents.clear()
      s.first = s.last = -1
      s.revision++
    },
  }
}

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
  const s: Streamed = {
    before: createSparseInts(),
    after: createSparseInts(),
    records: new Map<number, PageRec>(),
    started: createSparseInts(),
    dependents: createSparseInts(),
    first: -1,
    last: -1,
    starts: 0,
    revision: 0,
  }
  return joinMembers(streamedQueries(s), streamedMoves(s))
}
