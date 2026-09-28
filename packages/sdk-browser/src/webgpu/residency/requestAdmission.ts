import type { PageRec } from '../../page/selection/selection.ts';
import type { GroupClosure } from '../../page/cut/groupClosure.ts';
import { createSparseInts, grown } from '../../page/cut/sparseInts.ts';
import type { WebgpuResidencySets } from './sets.ts';
import type { createWebgpuPageTracking } from '../row/pageTracking.ts';

type Tracking = ReturnType<typeof createWebgpuPageTracking>;

/** What admission reads of a GPU cut: its requests (`../../gpu/dag/request.ts`), and whether the
 *  adopter took them (`../cut/adoption.ts`), which a truncated or undrawable readback it does not. */
type Requests = {
  readonly result: {
    readonly pageIds: ArrayLike<number>;
    readonly truncated?: boolean;
    readonly drawablePageIds?: unknown;
  };
};

/**
 * Admission on the GPU-cut path (#836): the queue is read off the readback's requests, closed over
 * their groups (`../../page/cut/groupClosure.ts`), and never off the CPU ranking.
 *
 * A cut the pool holds whole is the queue itself, followed by difference. One it does not hold
 * keeps its coarsest levels whole and the finest it straddles in part, as the documented budget
 * says (docs/ENGINE.md, Memory): a complete cover plus as much detail as the slots carry, paid one
 * level at a time. A page is filed at the coarsest level a placement brings it at.
 *
 * The room is the pool's, fixed: never what the image draws, which moves with every arrival — a
 * room that followed it admitted another set at each arrival and never settled. And at the level
 * it straddles, what the queue already holds goes first: the GPU orders equal requests by the race
 * of its threads, and a queue re-ranked to them would trade slots at every readback.
 *
 * Only a new readback, a new room or a queue changed elsewhere is ranked again: one walk of the
 * closed requests, bounded by the view's request list, never the catalogue (#483 rule 6).
 */
export function createRequestAdmission(
  sets: WebgpuResidencySets,
  { keyOf, wanted }: Pick<Tracking, 'keyOf' | 'wanted'>,
  closure: Pick<GroupClosure, 'closeOver'>,
) {
  /** Per key the walk reached, one plus the visit that filed it: the first at its coarsest level.
   *  A visit a coarser one superseded has its level set to -1. */
  const filedBy = createSparseInts();
  let keys = new Int32Array(0),
    levels = new Int32Array(0),
    /** Keys filed per level, and the queue written from them. */
    perLevel = new Int32Array(8),
    queue = new Int32Array(0);
  const pages: PageRec[] = [],
    queued: PageRec[] = [];
  let visits = 0,
    top = 0,
    last: Requests | null = null,
    lastRoom = -1,
    lastRevision = -1;
  const visit = (_id: number, rec: PageRec) => {
    const key = keyOf(rec);
    if (sets.covers(key)) return;
    const level = rec.level ?? 0,
      filed = filedBy.get(key);
    if (filed && levels[filed - 1] >= level) return;
    if (filed) {
      perLevel[levels[filed - 1]]--;
      levels[filed - 1] = -1;
    }
    if (level >= perLevel.length) perLevel = grown(perLevel, level + 1, perLevel.length);
    perLevel[level]++;
    top = Math.max(top, level);
    if (visits === keys.length) {
      keys = grown(keys, visits + 1, visits);
      levels = grown(levels, visits + 1, visits);
    }
    keys[visits] = key;
    levels[visits] = level;
    pages[visits++] = rec;
    filedBy.set(key, visits);
  };
  /** Writes into `queue` the pages of `level` the walk filed, from `at`, up to `end`; with `held`
   *  set, only those the queue already holds, otherwise only the others. */
  const take = (level: number, at: number, end: number, held?: boolean) => {
    for (let i = 0; i < visits && at < end; i++) {
      if (levels[i] !== level || (held !== undefined && wanted.has(keys[i]) !== held)) continue;
      queue[at] = keys[i];
      queued[at++] = pages[i];
    }
    return at;
  };
  /** The coarsest levels whole, then the one that straddles `room`, what the queue holds first. */
  const rank = (room: number) => {
    let floor = top,
      taken = 0;
    while (floor > 0 && taken + perLevel[floor] < room) taken += perLevel[floor--];
    const end = Math.min(room, taken + perLevel[floor]);
    if (queue.length < end) queue = new Int32Array(end);
    for (let level = top, at = 0; level > floor; level--) at = take(level, at, taken);
    take(floor, take(floor, taken, end, true), end, false);
    queued.length = end;
    return end;
  };
  return (room: number, cut: Requests | null) => {
    if (sets.desiredCount <= room) return sets.followDesired();
    // A readback the adopter refused, or none yet: the queue the image holds stands.
    if (!cut || cut.result.truncated || !cut.result.drawablePageIds) return;
    if (cut === last && room === lastRoom && sets.acceptedRevision === lastRevision) return;
    visits = top = 0;
    perLevel.fill(0);
    filedBy.clear();
    closure.closeOver(cut.result.pageIds, visit);
    const count = rank(room);
    sets.admit(queue, queued, count);
    last = cut;
    lastRoom = room;
    lastRevision = sets.acceptedRevision;
  };
}
