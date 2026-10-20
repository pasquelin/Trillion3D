import type { PageRec } from '../selection/types.ts'
import { createSparseInts } from '../cut/sparseInts.ts'
import { ADMISSION_BUCKETS, ADMISSION_LEVEL_MAX } from '../dag/request/request.ts'
import { createDenseKeySet, type DenseKeySet } from '../cut/adoption/denseKeys.ts'

/** Ranks a key can hold: its admission bucket, a drawn capture's lifted above every other. */
const RANKS = 2 * ADMISSION_BUCKETS

/** A page's admission rank (`../dag/request/request.ts`, the GPU's bucket): its level, the minimum
 *  capacity's pages above every level (`../../session/memory/minimumCapacity.ts`). */
export const admissionRank = (rec: PageRec) =>
  Math.min(rec.level ?? 0, ADMISSION_LEVEL_MAX) + (rec.rootChild ? ADMISSION_LEVEL_MAX + 1 : 0)

/**
 * THE ONE FILL OF THE UPLOAD QUEUE (`tracking.wanted`): the keys the views' cuts ask for (`sets.ts`,
 * `requested`), ranked by admission — a key at the highest rank any of its holders gives it, a
 * drawn capture's keys lifted above all (#268) —, the first `room` of them queued: every rank above
 * the floor whole, the floor's in part, what the queue holds of it kept. The queue follows the cuts
 * by difference: a key that enters or leaves, or moves rank, costs O(1) — and the room it frees or
 * fills a promotion or a demotion at the floor, found by a cached pointer —, so a pool that holds
 * the cuts queues each one as it comes and a short pool keeps the coarsest levels whole, with no
 * readback walked nor merged. `order` lays the queue out by rank, coarsest first, for the job that
 * walks it (`queueJob.ts`). `enqueue`/`dequeue` are the queue's own entry and exit.
 */
export function createRankedQueue(o: {
  enqueue: (key: number, page: PageRec) => void
  dequeue: (key: number) => void
  pageOf: (key: number) => PageRec
  wanted: DenseKeySet
}) {
  /** Holders of each key at each bucket, `key · ADMISSION_BUCKETS + bucket`; each key's highest
   *  bucket held, plus one; each listed key's rank, plus one. */
  const holders = createSparseInts(),
    baseOf = createSparseInts(),
    rankOf = createSparseInts()
  const lifted = new Set<number>()
  const queued: DenseKeySet[] = [],
    waiting: DenseKeySet[] = []
  for (let r = 0; r < RANKS; r++) {
    queued[r] = createDenseKeySet()
    waiting[r] = createDenseKeySet()
  }
  // The cuts whole until an admission names the room (`requestAdmission.ts`).
  let room = Infinity,
    count = 0,
    waitingCount = 0,
    floor = RANKS,
    top = -1,
    ordered = true
  /** The lowest rank the queue holds a key at, scanned up from the last one. */
  const floorRank = () => {
    while (floor < RANKS && !queued[floor].count) floor++
    return floor
  }
  /** The highest rank a waiting key stands at, scanned down from the last one. */
  const topRank = () => {
    while (top >= 0 && !waiting[top].count) top--
    return top
  }
  const promote = (r: number) => {
    const key = waiting[r].list[waiting[r].count - 1]
    waiting[r].remove(key)
    waitingCount--
    queued[r].add(key)
    if (r < floor) floor = r
    count++
    ordered = false
    o.enqueue(key, o.pageOf(key))
  }
  const demote = (r: number) => {
    const key = queued[r].list[queued[r].count - 1]
    queued[r].remove(key)
    count--
    waiting[r].add(key)
    waitingCount++
    if (r > top) top = r
    o.dequeue(key)
  }
  /** The queue made the first `room` keys by rank again, a key moved at a time. */
  const rebalance = () => {
    for (;;) {
      if (count > room) demote(floorRank())
      else if (waitingCount && count < room) promote(topRank())
      else if (waitingCount && topRank() > floorRank()) {
        promote(topRank())
        demote(floorRank())
      } else return
    }
  }
  /** `key`'s rank: its holders' highest bucket, lifted when a drawn capture asks for it. */
  const rankFor = (key: number) => baseOf.get(key) - 1 + (lifted.has(key) ? ADMISSION_BUCKETS : 0)
  /** A listed `key` filed at rank `r`: where it stood — queued or waiting — it stays, then the
   *  queue is ranked again. */
  const place = (key: number, r: number) => {
    const was = rankOf.set(key, r + 1) - 1
    if (was >= 0 && queued[was].remove(key)) {
      queued[r].add(key)
      if (r < floor) floor = r
      ordered = false
    } else {
      if (was >= 0 && waiting[was].remove(key)) waitingCount--
      waiting[r].add(key)
      waitingCount++
      if (r > top) top = r
    }
    rebalance()
  }
  const listed = (key: number) => rankOf.get(key) > 0
  return {
    /** A holder of `key` at `bucket` joined (`admissionRank`): a listed key moves up to it. */
    hold(key: number, bucket: number) {
      holders.add(key * ADMISSION_BUCKETS + bucket, 1)
      if (bucket < baseOf.get(key)) return
      baseOf.set(key, bucket + 1)
      if (listed(key) && rankFor(key) !== rankOf.get(key) - 1) place(key, rankFor(key))
    },
    /** A holder of `key` at `bucket` left: the key's highest bucket is read again only when it was
     *  that one's last holder, and a listed key moves down to its next holder's. */
    drop(key: number, bucket: number) {
      if (holders.add(key * ADMISSION_BUCKETS + bucket, -1) > 0 || bucket !== baseOf.get(key) - 1)
        return
      let b = bucket
      while (b > 0 && !holders.get(key * ADMISSION_BUCKETS + b - 1)) b--
      baseOf.set(key, b)
      // Its last holder gone, the key leaves the cuts' asks next (`leave`).
      if (b && listed(key) && rankFor(key) !== rankOf.get(key) - 1) place(key, rankFor(key))
    },
    /** `key` joined the cuts' asks (`keyUnion`, `onListed`). */
    enter: (key: number) => place(key, rankFor(key)),
    /** `key` left them: out of the queue, its place to the next waiting key. */
    leave(key: number) {
      const r = rankOf.set(key, 0) - 1
      if (r < 0) return
      if (queued[r].remove(key)) {
        count--
        o.dequeue(key)
      } else if (waiting[r].remove(key)) waitingCount--
      rebalance()
    },
    /** The slots the queue may fill. */
    setRoom(slots: number) {
      room = Math.max(0, slots)
      rebalance()
    },
    /** The keys a drawn capture's cut closes over (#268), lifted above every other; none after it. */
    lift(keys: ReadonlySet<number>) {
      const moved = [...lifted].filter((key) => !keys.has(key))
      for (const key of keys) if (!lifted.has(key)) moved.push(key)
      lifted.clear()
      for (const key of keys) lifted.add(key)
      for (const key of moved) if (listed(key)) place(key, rankFor(key))
    },
    /** The queue laid out by rank, coarsest first, once it moved: the order the job admits in. */
    order() {
      if (ordered) return
      o.wanted.clear()
      for (let r = RANKS - 1; r >= 0; r--)
        for (let i = 0; i < queued[r].count; i++) {
          const key = queued[r].list[i]
          o.wanted.add(key, o.pageOf(key))
        }
      ordered = true
    },
    /** Bytes of its tables: the holders and the ranked sets, bounded by the cuts' asks. */
    get byteLength() {
      let bytes = holders.byteLength + baseOf.byteLength + rankOf.byteLength
      for (let r = 0; r < RANKS; r++) bytes += queued[r].byteLength + waiting[r].byteLength
      return bytes
    },
  }
}
