import { catalogueIndexOf, type PageRec } from './pageSelection.ts';

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
  readonly entered: Int32Array;
  readonly exited: Int32Array;
  readonly enteredCount: number;
  readonly exitedCount: number;
  /** Ids the cut holds. */
  readonly count: number;
  /**
   * False when the applied shown list carries exactly the same id sequence as the previous one,
   * in the same order: `pages` was rewritten with the same records, at the same ranks. This is
   * not set equality — a different order, even at equal set, is a change — and that is what
   * whoever reads `pages` in order needs.
   */
  readonly changed: boolean;
  /** True when the id belongs to the held shown list. */
  has(id: number): boolean;
  /** Reports no difference: the cut is the one already held, records included. */
  hold(): void;
  /** Difference between `ids` and the cut held, and `pages` rewritten in the order of `ids`. */
  apply(ids: readonly number[]): void;
  /**
   * The same difference, published by a cut that names its records instead of their ranks — the
   * CPU cut. The catalogue has the last word, as everywhere. Nothing is allocated past the first
   * cut.
   */
  adoptRecords(records: readonly PageRec[]): void;
};

/**
 * The opaque cut as a set that outlives the image: given the page ids the GPU published, it names the
 * pages that entered and left since the previous cut, so every consumer downstream reads a difference
 * instead of a list.
 *
 * `pages` — the record array the caller owns — is written in the order the cut published, which is
 * the order the host streams in, and this difference is its only writer. A caller that only wants
 * the difference omits it: no record list is then built, and the shown list costs only its own
 * length.
 *
 * Nothing is allocated once the scene is known, and nothing is called per page: membership is an
 * epoch mark read on a typed array — the shown-list epoch for dedup, that of the previous shown
 * list for entry —, exits are read on the previously held list, and a frame that adopts the shown
 * list it already holds writes nothing at all.
 *
 * The GPU cut arrives there by its ids (`apply`), the CPU cut by its records (`adoptRecords`): one
 * contract, and readers do not know which one decides.
 */
export function createCutDelta(packedPages: readonly PageRec[], pages?: PageRec[]): CutDelta {
  const capacity = Math.max(1, packedPages.length);
  /** Epoch of the shown list where the id was last held. */
  const mark = new Int32Array(capacity).fill(-1);
  const entered = new Int32Array(capacity),
    exited = new Int32Array(capacity);
  /** Ids held by the previous shown list and by the current one: two swapped buffers, never
   *  reallocated, because exits are read on the old one while the new one is written. */
  let kept = new Int32Array(capacity),
    keptNext = new Int32Array(capacity);
  /** Id sequence the last shown list published, to compare it as-is. */
  const published = new Int32Array(capacity);
  let epoch = 0,
    keptCount = 0,
    publishedCount = -1;
  /**
   * True when `ids` is exactly the sequence the last applied shown list published. One integer
   * pass, without a single write: it is what allows doing nothing at all — neither the marks, nor
   * the held list, nor the records — when a new shown list republishes the same cut.
   */
  const samePublished = (ids: readonly number[]) => {
    if (ids.length !== publishedCount || ids.length > capacity) return false;
    for (let i = 0; i < ids.length; i++) if (published[i] !== ids[i]) return false;
    return true;
  };
  /** Held shown list: no difference is published, and the list is already the one it describes. */
  const hold = () => {
    state.changed = false;
    state.enteredCount = 0;
    state.exitedCount = 0;
  };
  /** Page ranks of a record list. Emptied then filled by push, never grown by its length: an array
   *  grown that way stays holed for life, and the engine's hottest loop pays for it. Measured:
   *  1.611 ms against 1.737 ms for an equivalent typed buffer. */
  const recordIds: number[] = [];
  const apply = (ids: readonly number[]) => {
    // A new shown list that republishes the same sequence describes the cut already held: it is
    // held, and not one of the fifteen thousand records is rewritten.
    if (samePublished(ids)) return hold();
    const previous = epoch;
    epoch++;
    let enteredCount = 0,
      exitedCount = 0;
    // A sequence longer than the catalogue is not kept: it is declared changed.
    let same = ids.length === publishedCount && ids.length <= capacity;
    publishedCount = ids.length <= capacity ? ids.length : -1;
    let keptNow = 0;
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      if (i < capacity && published[i] !== id) {
        published[i] = id;
        same = false;
      }
      if (id < 0 || id >= capacity) continue;
      const seen = mark[id];
      if (seen === epoch) continue;
      const rec = packedPages[id];
      if (!rec) continue;
      mark[id] = epoch;
      if (pages) pages[keptNow] = rec;
      keptNext[keptNow++] = id;
      if (seen !== previous) entered[enteredCount++] = id;
    }
    if (pages) pages.length = keptNow;
    for (let i = 0; i < keptCount; i++) {
      const id = kept[i];
      if (mark[id] !== epoch) exited[exitedCount++] = id;
    }
    const swap = kept;
    kept = keptNext;
    keptNext = swap;
    keptCount = keptNow;
    state.enteredCount = enteredCount;
    state.exitedCount = exitedCount;
    state.count = keptNow;
    state.changed = !same;
  };
  const state = {
    entered,
    exited,
    enteredCount: 0,
    exitedCount: 0,
    count: 0,
    changed: true,
    has: (id: number) => id >= 0 && id < capacity && mark[id] === epoch,
    hold,
    apply,
    adoptRecords(records: readonly PageRec[]) {
      recordIds.length = 0;
      for (let i = 0; i < records.length; i++) {
        const id = catalogueIndexOf(packedPages, records[i]);
        if (id !== undefined) recordIds.push(id);
      }
      apply(recordIds);
    },
  };
  return state;
}
