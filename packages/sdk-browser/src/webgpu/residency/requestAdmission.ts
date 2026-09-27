import type { PageRec } from '../../page/selection/selection.ts';
import type { GroupClosure } from '../../page/cut/groupClosure.ts';
import { createSparseInts, grown } from '../../page/cut/sparseInts.ts';
import type { WebgpuResidencySets } from './sets.ts';

/** What admission reads of a GPU cut: its requests, sorted by the GPU (`../../gpu/dag/request.ts`). */
type Requests = { readonly result: { readonly pageIds: ArrayLike<number> } };

/**
 * Admission on the GPU-cut path (#836): what the pool accepts follows the requests the GPU drained
 * and sorted (#478) — every visible request before every one ahead, the larger replacement error
 * first — and the host ranks nothing.
 *
 * A cut the pool holds whole is the upload queue itself, followed by difference. One it does not
 * hold is admitted request by request, each with the pages it closes over
 * (`../../page/cut/groupClosure.ts`), while they fit `room`: a request whose closure does not fit
 * is refused, and so is every one ranked below it. A refused page is drawn by its nearest resident
 * ancestor and never awaited (`accepts`, `../cut/pending.ts`), so the cut never waits for a page
 * the pool cannot hold; an admitted one arrives with everything the cut rule needs to draw it.
 *
 * Only a new readback, a new room or a queue changed elsewhere is ranked again, and the walk stops
 * at the budget: its cost is that of the pool, never that of the cut.
 */
export function createRequestAdmission(
  sets: WebgpuResidencySets,
  keyOf: (page: PageRec) => number,
  bootstrapKey: Uint8Array,
  closure: Pick<GroupClosure, 'closeOver'>,
) {
  const pages: PageRec[] = [];
  let keys = new Int32Array(0);
  /** Keys this walk listed: the pages a request closes over repeat those of the requests above. */
  const listed = createSparseInts();
  let count = 0,
    /** Pages listed before the request being walked: where a closure that overruns is cut back. */
    whole = 0,
    room = 0,
    last: Requests | null = null,
    lastRevision = -1;
  const list = (_id: number, rec: PageRec) => {
    const key = keyOf(rec);
    if (bootstrapKey[key] || listed.set(key, 1)) return;
    if (count === keys.length) keys = grown(keys, count + 1, count);
    keys[count] = key;
    pages[count++] = rec;
  };
  /** Read before each request: the walk stops once the last closure overran, or the room is full. */
  const full = () => {
    if (count > room) return true;
    whole = count;
    return count === room;
  };
  return (slots: number, cut: Requests | null) => {
    if (sets.desiredCount <= slots) return sets.followDesired();
    // Before the first readback, the queue the image started with stands.
    if (!cut) return;
    if (cut === last && slots === room && sets.acceptedRevision === lastRevision) return;
    room = slots;
    count = whole = 0;
    listed.clear();
    closure.closeOver(cut.result.pageIds, list, full);
    if (count > room) count = whole;
    pages.length = count;
    sets.admit(keys, pages, count);
    last = cut;
    lastRevision = sets.acceptedRevision;
  };
}
