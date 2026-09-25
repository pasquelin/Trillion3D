import type { PageRec } from '../../page/selection/selection.ts';
import type { IdDelta } from './delta.ts';
import { createDenseKeySet } from './denseKeys.ts';
import { createSparseInts } from '../../page/cut/sparseInts.ts';
import { awaitsClosure, awaitsPageBytes } from '../row/pageSlots.ts';

/**
 * Pages of the requested cut that do not yet have their bytes, held from one image to the next.
 *
 * Two readers live off it, and both used to walk the whole cut to get, almost always, nothing:
 * the held image, which refuses to hold while an awaited page can still change the cut, and the
 * list of addresses the host must go fetch. Fifteen thousand records re-read per image to answer
 * "none".
 *
 * The set only moves here of what moves: the pages the cut difference names, and those whose
 * bytes just arrived or left — which the rank journal already names. `records` is the list of
 * missing records the pool accepted, and only the missing ones are walked: the rule that turns
 * them into addresses is everyone's (`collectPendingUrls`), not a copy. Membership in the cut is
 * that of the difference, to which this set is attached once and for all.
 */
export type CutPending = ReturnType<typeof createCutPending>;

export function createCutPending(
  packedPages: readonly PageRec[],
  delta: IdDelta,
  accepted: (rec: PageRec) => boolean = () => true,
  /** Changes whenever `accepted` may answer differently: the awaited list is rebuilt then only. */
  acceptedRevision: () => number = () => 0,
) {
  /** Records of the missing pages, held at their key rank by the set itself. */
  const records: PageRec[] = [];
  const missing = createDenseKeySet(records);
  /** The missing records the pool accepted: the only ones an image waits for and the host fetches.
   *  A page past the page budget never gets a slot, so waiting for it would never settle. */
  const awaited: PageRec[] = [];
  /** Cut records that name a closure (`PageRec.dependencies`), and how many of them name each
   *  record: that record's bytes arriving or leaving moves cut records the journal does not name.
   *  Both follow the cut, never the catalogue. */
  const dependents = createDenseKeySet(),
    named = createSparseInts();
  const name = (id: number, step: number) => {
    const dependencies = packedPages[id].dependencies;
    if (!dependencies?.length) return;
    if (step > 0) dependents.add(id);
    else dependents.remove(id);
    for (const dependency of dependencies)
      if (dependency.packedIndex !== undefined) named.add(dependency.packedIndex, step);
  };
  /** A dependency arrived (`settle`: drop the members now complete) or left (`rescan`: the cut's
   *  dependents are re-read). Both are done once, when the set is next read. */
  let settle = false,
    rescan = false,
    /** The awaited list no longer matches `missing` or `accepted`. */
    stale = true,
    revision = 0;
  const reconcile = () => {
    if (rescan)
      for (let i = 0; i < dependents.count; i++) {
        const id = dependents.list[i];
        if (awaitsClosure(packedPages[id]) && missing.add(id, packedPages[id])) stale = true;
      }
    if (settle || rescan)
      for (let i = missing.count - 1; i >= 0; i--)
        if (!awaitsClosure(records[i]) && missing.remove(missing.list[i])) stale = true;
    settle = rescan = false;
    const now = acceptedRevision();
    if (!stale && now === revision) return;
    stale = false;
    revision = now;
    awaited.length = 0;
    for (let i = 0; i < missing.count; i++) if (accepted(records[i])) awaited.push(records[i]);
  };
  return {
    /** Records the pool accepted that still await their bytes or those of their closure, and their
     *  count: the held image only reads that count. */
    get records() {
      reconcile();
      return awaited;
    },
    get count() {
      reconcile();
      return awaited.length;
    },
    /** Bytes of the sets above, all sized by the cut. */
    get hostBytes() {
      return missing.byteLength + dependents.byteLength + named.byteLength;
    },
    /** The difference that has just been applied: exits first, entries next. */
    apply() {
      const exits = delta.exited,
        entries = delta.entered;
      for (let i = 0; i < delta.exitedCount; i++) {
        const id = exits[i];
        name(id, -1);
        if (missing.remove(id)) stale = true;
      }
      for (let i = 0; i < delta.enteredCount; i++) {
        const id = entries[i];
        const rec = packedPages[id];
        name(id, 1);
        if (awaitsClosure(rec) && missing.add(id, rec)) stale = true;
      }
    },
    /** A page's bytes have just arrived or left. */
    touch(id: number) {
      const rec = packedPages[id];
      if (named.get(id) > 0) {
        if (awaitsPageBytes(rec)) rescan = true;
        else settle = true;
      }
      if (!delta.has(id)) return;
      if (awaitsClosure(rec) ? missing.add(id, rec) : missing.remove(id)) stale = true;
    },
  };
}
