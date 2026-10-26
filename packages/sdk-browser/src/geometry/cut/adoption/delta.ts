import type { PageRec } from '../../selection/types.ts'
import { createSparseInts } from '../sparseInts.ts'
import { resized } from '../../../../../math/src/sequence/resized.ts'
import { sameRange } from '../../../../../math/src/matrix/matrixElements.ts'
import { createPageCatalogue, type PageList } from '../../selection/catalogue.ts'
import type { HeldList } from './heldList.ts'
import { applyHashed } from './hashedDifference.ts'

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
  /** The held id sequence, in the order `pages` was written: the packed ranks a reader
   *  of a record list needs to name its instances' placements. */
  readonly ids: Int32Array
  /** Reports no difference: the cut is the one already held, records included. */
  hold(): void
  /** Difference between `ids` and the cut held, and `pages` rewritten in the order of `ids`. A
   *  reused list is passed whole with its `count`, so only the live ranks are read and no stale
   *  tail is walked: each id is marked in turn (`./hashedDifference.ts`). */
  apply(ids: ArrayLike<number>, count?: number): void
  /**
   * The same difference, published by a list that names its records instead of their ranks — the
   * bootstrap cover before the first readback. `rankOf` resolves each record's first packed rank; a record it does not hold yields
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
 * Every table follows the cut, never the catalogue: membership is an epoch mark held
 * in a sparse map (`../sparseInts.ts`) for the ids the cut holds, an id that leaves
 * loses its mark, and the lists grow to the longest cut seen, then are rewritten in place. A frame
 * that adopts the shown list it already holds writes nothing at all.
 *
 * A cut arrives there by its ids (`apply`), the bootstrap cover by its records (`adoptRecords`):
 * one contract, and readers do not know which one decides. A list of ids that names no record — a
 * plan's pins — passes no `packedPages`: every id it names is listed, and its marks follow what it
 * holds as the cut's do.
 */
export function createCutDelta(packedPages?: PageList, pages?: PageRec[]): CutDelta {
  /** Page ranks of a record list. Emptied then filled by push, never grown by its length: an array
   *  grown that way stays holed for life, and the engine's hottest loop pays for it. Measured:
   *  1.611 ms against 1.737 ms for an equivalent typed buffer. */
  const recordIds: number[] = []
  const delta: HeldDelta = {
    recordOf: packedPages && createPageCatalogue(packedPages).recordOf,
    mark: createSparseInts(),
    pages,
    // Epochs start at 1: an id without a mark reads 0, never a current or previous epoch.
    epoch: 1,
    ids: new Int32Array(8),
    count: 0,
    next: new Int32Array(8),
    published: new Int32Array(8),
    publishedCount: -1,
    entered: new Int32Array(8),
    enteredCount: 0,
    exited: new Int32Array(8),
    exitedCount: 0,
    changed: true,
    has: (id: number) => delta.mark.get(id) === delta.epoch,
    /** Bytes of the marks and the lists, all sized by the longest cut seen. */
    get hostBytes() {
      return heldBytes(delta)
    },
    hold: () => holdDelta(delta),
    apply: (ids: ArrayLike<number>, count = ids.length) => applyDelta(delta, ids, count),
    adoptRecords(records: readonly PageRec[], rankOf: (rec: PageRec) => number) {
      recordIds.length = 0
      for (let i = 0; i < records.length; i++) {
        const id = rankOf(records[i])
        if (id >= 0) recordIds.push(id)
      }
      applyDelta(delta, recordIds, recordIds.length)
    },
  }
  return delta
}

type HeldDelta = HeldList & CutDelta

function heldBytes(delta: HeldDelta) {
  return (
    delta.mark.byteLength +
    delta.ids.byteLength +
    delta.next.byteLength +
    delta.published.byteLength +
    delta.entered.byteLength +
    delta.exited.byteLength
  )
}

/** Every list long enough for a cut of `count` after the one held: either difference grows them
 *  alike, so the bytes they weigh do not depend on which one ran. */
function growFor(delta: HeldDelta, count: number) {
  if (delta.published.length < count) delta.published = resized(delta.published, count)
  if (delta.next.length < count) delta.next = resized(delta.next, count)
  if (delta.entered.length < count) delta.entered = resized(delta.entered, count)
  if (delta.exited.length < delta.count) delta.exited = resized(delta.exited, delta.count)
}

/** Held shown list: no difference is published, and the list is already the one it describes. */
function holdDelta(delta: HeldDelta) {
  delta.changed = false
  delta.enteredCount = 0
  delta.exitedCount = 0
}

function applyDelta(delta: HeldDelta, ids: ArrayLike<number>, count: number) {
  // A new shown list that republishes the same sequence describes the cut already held: it is
  // held, and not one of the fifteen thousand records is rewritten: one integer pass, no write.
  if (count === delta.publishedCount && sameRange(delta.published, ids, count))
    return holdDelta(delta)
  growFor(delta, count)
  const next = applyHashed(delta, ids, count)
  delta.publishedCount = count
  // The next list becomes the held one.
  const swap = delta.ids
  delta.ids = delta.next
  delta.next = swap
  delta.count = next
  delta.changed = true
}
