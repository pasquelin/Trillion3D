import type { PageRec } from '../../page/selection/selection.ts'
import { createSparseInts, grown } from '../../page/cut/sparseInts.ts'
import { createPageCatalogue, type PageList } from '../pages/prepare/catalogue.ts'
import type { HeldList } from './heldList.ts'
import { applyHashed } from './hashedDifference.ts'
import { applyClaimed } from './claimedDifference.ts'

/**
 * Published difference, and what can be asked of it.
 *
 * Counts are FIELDS, not accessors: their readers walk them twenty thousand times per frame, an
 * accessor does not inline there, and each had to hoist the bound by hand — three times the same
 * gesture and three times the same comment — to recover the price of a field. The contract now
 * gives it once and for all. Buffers are rewritten in place, never reallocated, and what the
 * reader sees of them is valid until the next cut.
 */
export type CutDelta = {
  /** Ids that entered and left since the previous cut, and their count. */
  readonly entered: Int32Array
  readonly exited: Int32Array
  /** Bytes of the tables behind the difference. */
  readonly hostBytes: number
  readonly enteredCount: number
  readonly exitedCount: number
  /** Ids the cut holds. */
  readonly count: number
  /**
   * False when the applied shown list carries exactly the same id sequence as the previous one,
   * in the same order: `pages` was rewritten with the same records, at the same ranks. This is
   * not set equality — a different order, even at equal set, is a change — and that is what
   * whoever reads `pages` in order needs.
   */
  readonly changed: boolean
  /** True when the id belongs to the held shown list. */
  has(id: number): boolean
  /** The held id sequence, in the order `pages` was written (#1235): the packed ranks a reader
   *  of a record list needs to name its instances' placements. */
  readonly ids: ArrayLike<number>
  /** Reports no difference: the cut is the one already held, records included. */
  hold(): void
  /** Difference between `ids` and the cut held, and `pages` rewritten in the order of `ids`. The
   *  packed cut passes its reused `Int32Array` whole (`webgpu/pages/render/cpu.ts`): `count` is the
   *  record list's length, so only the live ranks are read and no stale tail is walked. The GPU
   *  cut passes the ranks its readback claims for them in the last list it applied (`claims`,
   *  `./claimedDifference.ts`); a list without them is marked id by id (`./hashedDifference.ts`).
   *  The same difference either way. */
  apply(ids: ArrayLike<number>, count?: number, claims?: Uint32Array): void
  /**
   * The same difference, published by a cut that names its records instead of their ranks — the
   * CPU cut. `rankOf` resolves each record's first packed rank; a record it does not hold yields
   * nothing. Nothing is allocated past the first cut.
   */
  adoptRecords(records: readonly PageRec[], rankOf: (rec: PageRec) => number): void
}

/** What a reader of a difference walks: the ids that entered and left, and membership. */
export type IdDelta = Pick<CutDelta, 'entered' | 'exited' | 'enteredCount' | 'exitedCount' | 'has'>

/**
 * The opaque cut as a set that outlives the image: given the page ids a cut published, it names the
 * pages that entered and left since the previous cut, so every consumer downstream reads a difference
 * instead of a list.
 *
 * `pages` — the record array the caller owns — is written in the order the cut published, which is
 * the order the host streams in, and this difference is its only writer. A caller that only wants
 * the difference omits it: no record list is then built, and the shown list costs only its own
 * length.
 *
 * Every table follows the cut, never the catalogue (#483 rule 6): membership is an epoch mark held
 * in a sparse map (`../../page/cut/sparseInts.ts`) for the ids the cut holds, an id that leaves
 * loses its mark, and the lists grow to the longest cut seen, then are rewritten in place. A frame
 * that adopts the shown list it already holds writes nothing at all.
 *
 * The GPU cut arrives there by its ids and the ranks its readback claims for them (`apply` with
 * claims), the CPU cut by its ids or records alone (`apply`, `adoptRecords`): one contract, and
 * readers do not know which one decides.
 */
export function createCutDelta(packedPages: PageList, pages?: PageRec[]): CutDelta {
  /**
   * True when `ids` is exactly the sequence the last applied shown list published. One integer
   * pass, without a single write: it is what allows doing nothing at all — neither the marks, nor
   * the held list, nor the records — when a new shown list republishes the same cut.
   */
  const samePublished = (ids: ArrayLike<number>, count: number) => {
    if (count !== delta.publishedCount) return false
    const published = delta.published
    for (let i = 0; i < count; i++) if (published[i] !== ids[i]) return false
    return true
  }
  /** Every list long enough for a cut of `count` after the one held: either difference grows them
   *  alike, so the bytes they weigh do not depend on which one ran. */
  const growFor = (count: number) => {
    if (delta.published.length < count) delta.published = grown(delta.published, count)
    if (delta.next.length < count) delta.next = grown(delta.next, count)
    if (delta.entered.length < count) delta.entered = grown(delta.entered, count)
    if (delta.exited.length < delta.count) delta.exited = grown(delta.exited, delta.count)
  }
  /** Page ranks of a record list. Emptied then filled by push, never grown by its length: an array
   *  grown that way stays holed for life, and the engine's hottest loop pays for it. Measured:
   *  1.611 ms against 1.737 ms for an equivalent typed buffer. */
  const recordIds: number[] = []
  /** Held shown list: no difference is published, and the list is already the one it describes. */
  const hold = () => {
    delta.changed = false
    delta.enteredCount = 0
    delta.exitedCount = 0
  }
  const apply = (ids: ArrayLike<number>, count = ids.length, claims?: Uint32Array) => {
    // A new shown list that republishes the same sequence describes the cut already held: it is
    // held, and not one of the fifteen thousand records is rewritten.
    if (samePublished(ids, count)) return hold()
    growFor(count)
    const next = claims ? applyClaimed(delta, ids, count, claims) : applyHashed(delta, ids, count)
    delta.publishedCount = count
    // The next list becomes the held one.
    const swap = delta.ids
    delta.ids = delta.next
    delta.next = swap
    delta.count = next
    delta.changed = true
  }
  const delta: HeldList & CutDelta = {
    recordOf: createPageCatalogue(packedPages).recordOf,
    mark: createSparseInts(),
    pages,
    // Epochs start at 1: an id without a mark reads 0, never a current or previous epoch.
    epoch: 1,
    ids: new Int32Array(8),
    count: 0,
    next: new Int32Array(8),
    published: new Int32Array(8),
    publishedCount: -1,
    rawRank: new Uint32Array(0),
    rawToHeld: false,
    entered: new Int32Array(8),
    enteredCount: 0,
    exited: new Int32Array(8),
    exitedCount: 0,
    changed: true,
    named: new Uint32Array(8),
    before: [],
    has: (id: number) => delta.mark.get(id) === delta.epoch,
    /** Bytes of the marks and the lists, all sized by the longest cut seen. */
    get hostBytes() {
      return (
        delta.mark.byteLength +
        delta.ids.byteLength +
        delta.next.byteLength +
        delta.published.byteLength +
        delta.rawRank.byteLength +
        delta.entered.byteLength +
        delta.exited.byteLength
      )
    },
    hold,
    apply,
    adoptRecords(records: readonly PageRec[], rankOf: (rec: PageRec) => number) {
      recordIds.length = 0
      for (let i = 0; i < records.length; i++) {
        const id = rankOf(records[i])
        if (id >= 0) recordIds.push(id)
      }
      apply(recordIds)
    },
  }
  return delta
}
