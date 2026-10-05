import type { PageRec } from '../../page/selection/selection.ts';
import { SELECTION_NONE as NONE } from '../../gpu/core/selection.ts';
import { grown } from '../../page/cut/sparseInts.ts';
import { copyPages } from '../pages/helpers.ts';
import { mapRawRanks, type HeldList } from './heldList.ts';

/** The mark of a held id or an entry this list names at a rank no claim reached, until the held
 *  ranks are read: an id read back at it again is a repeat. */
const PENDING = -1;
/** An id of the list the next one does not keep: a repeat, or one without a record. */
const SKIPPED = -1;

/**
 * The difference of a GPU list read off the ranks it claims in the last list applied
 * (`../../gpu/dag/differenceChain.ts`): `claims[i]`, for rank `i` of `ids`, the rank its page holds
 * in that list as it was published — the held rank once the ids that list skipped are counted out
 * (`HeldList.rawRank`) —, or none.
 *
 * A claim is believed when the held list holds that very id at that rank: the page stays, with the
 * record of its rank, and no id is looked up — the one pass a frame runs over every rank. Any
 * other rank is read by its mark, as the CPU cut reads all of them (`./hashedDifference.ts`): no
 * mark, it entered; the held epoch, the GPU lost sight of it in between and the host still holds it
 * — a page that left a voided snapshot and came back —; marked by this very list, a repeat. Then
 * the held ranks no claim named and no mark kept are the exits, in the order of the held list.
 * Entries in the order of `ids`, exits in the order held, repeats and ids without a record skipped:
 * the hashed difference's lists, record for record, whatever ranks the claims name — they only
 * decide how many ids are looked up.
 *
 * What it asks of them: every occurrence of one page carries the same claim, or a repeat could be
 * kept once by its claim and once by its mark. The GPU reads one kept rank per page, and the chain
 * carries equal ranks to equal claims. Returns the next list's length.
 */
export function applyClaimed(
  held: HeldList,
  ids: ArrayLike<number>,
  count: number,
  claims: Uint32Array,
) {
  const { mark, recordOf, pages, ids: kept, count: keptCount, next, entered, exited } = held,
    epoch = held.epoch,
    words = (keptCount + 31) >>> 5;
  if (held.named.length < words) held.named = grown(held.named, words);
  held.named.fill(0, 0, words);
  // A held page keeps the record of the rank it held: a packed rank's record never changes, the
  // catalogue only grows behind its ranks (`postPackedBases`). They are read off a copy, as the
  // records are rewritten in the order of `ids`, at ranks the list already reaches: a record
  // array written past its end holds holes, every read of it after that paid.
  if (pages) {
    copyPages(held.before, pages);
    if (pages.length) while (pages.length < count) pages.push(pages[0]);
  }
  // The ranks no claim reached, in `entered` until the entries' ids replace them; a repeat of a
  // claimed page as its complement.
  const raw = held.rawToHeld ? held.rawRank : null;
  const waiting = carryClaimed(
    ids,
    count,
    claims,
    raw,
    kept,
    keptCount,
    pages,
    next,
    held,
    entered,
  );
  let skipped = 0,
    enteredCount = 0;
  for (let u = 0; u < waiting; u++) {
    const w = entered[u];
    if (w < 0) {
      next[~w] = SKIPPED;
      skipped++;
      continue;
    }
    const id = ids[w],
      rec = recordOf(id);
    // No record: the list never holds it. Marked by this list already: a repeat.
    const seen = rec ? mark.set(id, PENDING) : PENDING;
    if (seen === PENDING) {
      next[w] = SKIPPED;
      skipped++;
      continue;
    }
    if (seen !== epoch) entered[enteredCount++] = id;
    if (pages) {
      // A list that held no record reaches its ranks only here: filled whole from the first.
      while (pages.length < count) pages.push(rec!);
      if (pages[w] !== rec) pages[w] = rec!;
    }
  }
  // The held ranks no claim named: kept when this list marked them, gone otherwise.
  const named = held.named;
  let exitedCount = 0;
  for (let w = 0; w < words; w++) {
    let bits = ~named[w];
    if (w === words - 1 && keptCount & 31) bits &= (1 << (keptCount & 31)) - 1;
    for (; bits; bits &= bits - 1) {
      const id = kept[(w << 5) + 31 - Math.clz32(bits & -bits)];
      if (mark.set(id, epoch) !== PENDING) {
        exited[exitedCount++] = id;
        mark.set(id, 0);
      }
    }
  }
  for (let k = 0; k < enteredCount; k++) mark.set(entered[k], epoch);
  held.rawToHeld = skipped > 0;
  const nextCount = skipped ? compact(held, pages, count) : count;
  if (pages) pages.length = nextCount;
  held.enteredCount = enteredCount;
  held.exitedCount = exitedCount;
  return nextCount;
}

/**
 * The claims believed, carried: for each rank `i` of `ids` whose claim, through `raw` when the list
 * before skipped ids, names held rank `t` holding that very id, `t` is named — a second rank naming
 * it is a repeat, listed as `~i` — and its record, from `held.before`, carried into `pages`;
 * every other rank is listed in `waiting`. Every id is copied into `next` and `held.published`.
 * Returns the ranks listed. Its own function, with no call in its loop: it is the one loop a frame
 * runs over every rank of the list, and compiles alone.
 */
function carryClaimed(
  ids: ArrayLike<number>,
  count: number,
  claims: Uint32Array,
  raw: Uint32Array | null,
  kept: Int32Array,
  keptCount: number,
  pages: PageRec[] | undefined,
  next: Int32Array,
  held: HeldList,
  waiting: Int32Array,
) {
  const { named, before } = held,
    published = held.published;
  let listed = 0;
  for (let i = 0; i < count; i++) {
    const id = ids[i];
    let t = claims[i];
    if (raw && t !== NONE) t = raw[t];
    next[i] = id;
    published[i] = id;
    if (!(t < keptCount) || kept[t] !== id) {
      waiting[listed++] = i;
      continue;
    }
    const w = t >>> 5,
      bit = 1 << (t & 31);
    if (named[w] & bit) {
      waiting[listed++] = ~i;
      continue;
    }
    named[w] |= bit;
    // A record already at its rank is not written again: placements of one primitive share it.
    if (pages && pages[i] !== before[t]) pages[i] = before[t];
  }
  return listed;
}

/** The ids the next list keeps moved down over the skipped ones, records with them, and the held
 *  rank of each raw rank written for the claims the next readback makes; their count. */
function compact(held: HeldList, pages: PageRec[] | undefined, count: number) {
  const next = held.next,
    raw = mapRawRanks(held, count, 0);
  let kept = 0;
  for (let i = 0; i < count; i++) {
    if (next[i] === SKIPPED) {
      raw[i] = NONE;
      continue;
    }
    raw[i] = kept;
    next[kept] = next[i];
    if (pages) pages[kept] = pages[i];
    kept++;
  }
  return kept;
}
