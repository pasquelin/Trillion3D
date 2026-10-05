import { SELECTION_NONE as NONE } from '../../gpu/core/selection.ts';
import { mapRawRanks, type HeldList } from './heldList.ts';

/**
 * The difference of a list named by its ids alone: every id through the marks, then every id held
 * before. It is the CPU cut's — its lists carry no rank of the list before, so membership is all
 * it can read — and the first GPU list's, which no snapshot before it names
 * (`./claimedDifference.ts` reads the ranks the next ones claim).
 *
 * A new epoch marks the next list: an id read back at it is a repeat, one read back at the epoch
 * before was held, one with no mark entered; a held id that did not get the new epoch left, and
 * loses its mark. An id without a record is skipped before it is marked: the list never holds it.
 * Returns the next list's length.
 */
export function applyHashed(held: HeldList, ids: ArrayLike<number>, count: number) {
  const { mark, recordOf, pages, ids: kept, count: keptCount, next, published } = held,
    { entered, exited } = held;
  const previous = held.epoch,
    epoch = ++held.epoch;
  let nextCount = 0,
    enteredCount = 0,
    exitedCount = 0,
    raw: Uint32Array | null = null;
  held.rawToHeld = false;
  for (let i = 0; i < count; i++) {
    const id = ids[i];
    published[i] = id;
    const rec = recordOf(id);
    const seen = rec ? mark.set(id, epoch) : epoch;
    if (seen === epoch) {
      raw ??= mapRawRanks(held, count, i);
      raw[i] = NONE;
      continue;
    }
    if (raw) raw[i] = nextCount;
    if (pages) pages[nextCount] = rec!;
    next[nextCount++] = id;
    if (seen !== previous) entered[enteredCount++] = id;
  }
  if (pages) pages.length = nextCount;
  for (let i = 0; i < keptCount; i++) {
    const id = kept[i];
    if (mark.get(id) !== epoch) {
      exited[exitedCount++] = id;
      mark.set(id, 0);
    }
  }
  held.enteredCount = enteredCount;
  held.exitedCount = exitedCount;
  return nextCount;
}
