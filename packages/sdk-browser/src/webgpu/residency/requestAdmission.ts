import type { PageRec } from '../../page/selection/selection.ts';
import type { GroupClosure } from '../../page/cut/groupClosure.ts';
import { createSparseInts, grown } from '../../page/cut/sparseInts.ts';
import type { WebgpuResidencySets } from './sets.ts';
import type { createWebgpuPageTracking } from '../row/pageTracking.ts';
import type { GpuCut } from '../../gpu/core/selection.ts';

type Tracking = ReturnType<typeof createWebgpuPageTracking>;
/** What admission reads of a GPU cut: its requests (`../../gpu/dag/request.ts`). */
type Requests = Pick<GpuCut, 'result'>;

/** The source of the CPU cut's ranking: the pages its cut closes over now. */
const HELD = {};

/**
 * Admission of both cuts, one ranking. The GPU cut's queue is read off the readback's requests,
 * closed over their groups (`../../page/cut/groupClosure.ts`) (#836); the CPU cut's off the pages
 * its cut closes over (`closure.forEachHeld`), so the GPU cut feeds no tracking of its own and the
 * CPU cut that takes the image back ranks what the GPU cut left (#974).
 *
 * A cut the pool holds whole is the queue itself, followed by difference. One it does not hold
 * keeps its coarsest levels whole and the finest it straddles in part, as the documented budget
 * says (docs/ENGINE.md, Memory): a complete cover plus as much detail as the slots carry, paid one
 * level at a time. A page is filed at the coarsest level a placement brings it at.
 *
 * The room is the pool's, fixed: never what the image draws, which moves with every arrival — a
 * room that followed it admitted another set at each arrival and never settled. And at the level
 * it straddles, what the queue already holds goes first, in the queue's order: the GPU orders equal
 * requests by the race of its threads and the held pages come in hash order, and a queue re-ranked
 * to either would trade slots at every readback.
 *
 * While a capture is drawn, the CPU cut ranks its own pages first, each lifted above every level
 * of the union (`sets.drawnFirst`): the capture keeps what its cut alone kept under the one budget,
 * and the other views' pages take what room is left (#268).
 *
 * Only a new readback (or a moved CPU cut), a new room or a queue changed elsewhere is ranked
 * again: one walk of the closed requests or the held pages, bounded by the view, never the
 * catalogue (#483 rule 6).
 */
export function createRequestAdmission(
  sets: WebgpuResidencySets,
  { keyOf, wanted }: Pick<Tracking, 'keyOf' | 'wanted'>,
  closure: Pick<GroupClosure, 'closeOver' | 'closeOverRecords' | 'forEachHeld'>,
) {
  /** Per key the walk reached, one plus the visit that filed it: the first at its coarsest level.
   *  A visit a coarser one superseded has its level set to -1. */
  const filedBy = createSparseInts();
  let keys = new Int32Array(0),
    levels = new Int32Array(0),
    /** Keys filed per level, and the queue written from them. */
    perLevel = new Int32Array(8),
    queue = new Int32Array(0),
    /** The filing visits sorted by level, coarsest first, in walk order within a level. */
    order = new Int32Array(0);
  const pages: PageRec[] = [],
    queued: PageRec[] = [];
  let visits = 0,
    top = 0,
    /** Added to a page's level: a capture's own are filed above the union's (`rankFrom`). */
    lift = 0,
    last: object | null = null,
    lastRoom = -1,
    lastRevision = -1,
    lastCut = -1,
    lastFirst: readonly PageRec[] | null = null;
  const visit = (_id: number, rec: PageRec) => {
    const key = keyOf(rec);
    if (sets.covers(key)) return;
    const level = (rec.level ?? 0) + lift,
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
  const put = (at: number, i: number) => {
    queue[at] = keys[i];
    queued[at] = pages[i];
  };
  /** The coarsest levels whole, then the one that straddles `room`, what the queue holds first. */
  const rank = (room: number) => {
    let floor = top,
      taken = 0;
    while (floor > 0 && taken + perLevel[floor] < room) taken += perLevel[floor--];
    const end = Math.min(room, taken + perLevel[floor]);
    if (queue.length < end) queue = grown(queue, end);
    if (order.length < visits) order = grown(order, visits);
    // A counting sort: each level from `floor` up gets its slice of `order`, and `perLevel[level]`
    // ends as where that slice ends. A superseded visit (-1) takes none.
    for (let level = top, start = 0; level >= floor; level--) {
      const count = perLevel[level];
      perLevel[level] = start;
      start += count;
    }
    for (let i = 0; i < visits; i++) if (levels[i] >= floor) order[perLevel[levels[i]]++] = i;
    for (let at = 0; at < taken; at++) put(at, order[at]);
    // The straddled level's queued pages keep the queue's own order, whatever the walk's.
    let at = taken;
    for (let i = 0; i < wanted.count && at < end; i++) {
      const filed = filedBy.get(wanted.list[i]);
      if (filed && levels[filed - 1] === floor) put(at++, filed - 1);
    }
    for (let s = taken; s < perLevel[floor] && at < end; s++)
      if (!wanted.has(keys[order[s]])) put(at++, order[s]);
    queued.length = end;
    return end;
  };
  /** Bytes of its tables, sized by the view's closed requests and the room: the CPU budget holds
   *  them with the cut's other host tables (`../cut/publication.ts`, `hostTableBytes`). */
  const hostBytes = () =>
    filedBy.byteLength +
    keys.byteLength +
    levels.byteLength +
    perLevel.byteLength +
    queue.byteLength +
    order.byteLength;
  /** Ranks at `room` what `ids` close over, or the held cut when `ids` is null, into the queue:
   *  unless the source, the room, the queue and the held cut are all as last ranked. */
  const rankFrom = (room: number, source: object, ids: ArrayLike<number> | null) => {
    const cutNow = ids ? -1 : sets.cutRevision,
      first = ids ? null : sets.drawnFirst;
    if (
      source === last &&
      room === lastRoom &&
      sets.acceptedRevision === lastRevision &&
      cutNow === lastCut &&
      first === lastFirst
    )
      return;
    // No room: an empty queue, without walking what it would rank.
    let count = 0;
    if (room > 0) {
      visits = top = 0;
      perLevel.fill(0);
      filedBy.clear();
      if (ids) closure.closeOver(ids, visit);
      else closure.forEachHeld(visit);
      // A capture's pages again, above the union's coarsest: a coarser filing supersedes.
      if (first) {
        lift = top + 1;
        closure.closeOverRecords(first, visit);
        lift = 0;
      }
      pages.length = visits;
      count = rank(room);
    } else queued.length = 0;
    sets.admit(queue, queued, count);
    last = source;
    lastRoom = room;
    lastRevision = sets.acceptedRevision;
    lastCut = cutNow;
    lastFirst = first;
  };
  /** The GPU cut's: its readback's requests. */
  const admit = (room: number, cut: Requests | null) => {
    // The queue follows the cut whole: no capture's cut is held for a ranking that may not come.
    if (sets.desiredCount <= room) return ((lastFirst = null), sets.followDesired());
    // A readback the adopter refused, or none yet: the queue the image holds stands.
    if (!cut || cut.result.truncated || !cut.result.drawablePageIds) return;
    rankFrom(room, cut, cut.result.pageIds);
  };
  /** The CPU cut's, whose difference is already applied: true when it overruns `room`. */
  const held = (room: number) => {
    if (sets.desiredCount <= room) {
      lastFirst = null;
      sets.followDesired();
      return false;
    }
    rankFrom(room, HELD, null);
    return true;
  };
  return Object.assign(admit, { held, hostBytes });
}
