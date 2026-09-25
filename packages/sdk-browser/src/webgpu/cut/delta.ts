import { catalogueIndexOf, type PageRec } from '../../page/selection/selection.ts';
import { createSparseInts, grown } from '../../page/cut/sparseInts.ts';

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
  /** Bytes of the tables behind the difference. */
  readonly hostBytes: number;
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

/** What a reader of a difference walks: the ids that entered and left, and membership. */
export type IdDelta = Pick<CutDelta, 'entered' | 'exited' | 'enteredCount' | 'exitedCount' | 'has'>;

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
 * Every table follows the cut, never the catalogue (#483 rule 6): membership is an epoch mark held
 * in a sparse map (`../../page/cut/sparseInts.ts`) for the ids the cut holds — the shown-list epoch
 * for dedup, that of the previous shown list for entry —, an id that leaves loses its mark, and the
 * lists grow to the longest cut seen, then are rewritten in place. Exits are read on the previously
 * held list, and a frame that adopts the shown list it already holds writes nothing at all.
 *
 * The GPU cut arrives there by its ids (`apply`), the CPU cut by its records (`adoptRecords`): one
 * contract, and readers do not know which one decides.
 */
export function createCutDelta(packedPages: readonly PageRec[], pages?: PageRec[]): CutDelta {
  const catalogue = packedPages.length;
  /** Epoch of the shown list where the id was last held; an id held by neither list has none. */
  const mark = createSparseInts();
  /** Ids held by the previous shown list and by the current one: two swapped buffers, grown and
   *  never shrunk, because exits are read on the old one while the new one is written. */
  let kept = new Int32Array(8),
    keptNext = new Int32Array(8);
  /** Id sequence the last shown list published, to compare it as-is. */
  let published = new Int32Array(8);
  // Epochs start at 1: an id without a mark reads 0, never a current or previous epoch.
  let epoch = 1,
    keptCount = 0,
    publishedCount = -1;
  /**
   * True when `ids` is exactly the sequence the last applied shown list published. One integer
   * pass, without a single write: it is what allows doing nothing at all — neither the marks, nor
   * the held list, nor the records — when a new shown list republishes the same cut.
   */
  const samePublished = (ids: readonly number[]) => {
    if (ids.length !== publishedCount) return false;
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
    if (published.length < ids.length) published = grown(published, ids.length);
    if (keptNext.length < ids.length) keptNext = grown(keptNext, ids.length);
    if (state.entered.length < ids.length) state.entered = grown(state.entered, ids.length);
    if (state.exited.length < keptCount) state.exited = grown(state.exited, keptCount);
    const { entered, exited } = state;
    let enteredCount = 0,
      exitedCount = 0;
    let same = ids.length === publishedCount;
    publishedCount = ids.length;
    let keptNow = 0;
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      if (published[i] !== id) {
        published[i] = id;
        same = false;
      }
      if (id < 0 || id >= catalogue) continue;
      const rec = packedPages[id];
      if (!rec) continue;
      const seen = mark.set(id, epoch);
      if (seen === epoch) continue;
      if (pages) pages[keptNow] = rec;
      keptNext[keptNow++] = id;
      if (seen !== previous) entered[enteredCount++] = id;
    }
    if (pages) pages.length = keptNow;
    for (let i = 0; i < keptCount; i++) {
      const id = kept[i];
      if (mark.get(id) !== epoch) {
        exited[exitedCount++] = id;
        mark.set(id, 0);
      }
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
    entered: new Int32Array(8),
    exited: new Int32Array(8),
    enteredCount: 0,
    exitedCount: 0,
    count: 0,
    changed: true,
    has: (id: number) => mark.get(id) === epoch,
    /** Bytes of the marks and the lists, all sized by the longest cut seen. */
    get hostBytes() {
      return (
        mark.byteLength +
        kept.byteLength +
        keptNext.byteLength +
        published.byteLength +
        state.entered.byteLength +
        state.exited.byteLength
      );
    },
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
