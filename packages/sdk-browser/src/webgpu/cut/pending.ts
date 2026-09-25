import type { PageRec } from '../../page/selection/selection.ts';
import type { IdDelta } from './delta.ts';
import { createDenseKeySet } from './denseKeys.ts';
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
 * missing records, and it alone is walked: the rule that turns them into addresses is everyone's
 * (`collectPendingUrls`), not a copy. Membership in the cut is that of the difference, to which
 * this set is attached once and for all.
 */
export type CutPending = ReturnType<typeof createCutPending>;

export function createCutPending(packedPages: readonly PageRec[], delta: IdDelta) {
  /** Records of the missing pages, held at their key rank by the set itself. */
  const records: PageRec[] = [];
  const missing = createDenseKeySet(packedPages.length, records);
  /** Ranks of the set: read straight from the array, the call is reserved for what moves. */
  const slots = missing.slots;
  /** The records a cut record's closure names (`PageRec.dependencies`): their bytes arriving or
   *  leaving moves cut records the journal does not name. */
  const named = new Uint8Array(Math.max(1, packedPages.length));
  for (const rec of packedPages)
    for (const dependency of rec.dependencies ?? [])
      if (dependency.packedIndex !== undefined) named[dependency.packedIndex] = 1;
  /** A dependency arrived (`settle`: drop the members now complete) or left (`rescan`: the cut is
   *  re-read). Both are done once, when the set is next read. */
  let settle = false,
    rescan = false;
  const reconcile = () => {
    if (rescan)
      for (let id = 0; id < packedPages.length; id++)
        if (packedPages[id].dependencies?.length && delta.has(id) && awaitsClosure(packedPages[id]))
          missing.add(id, packedPages[id]);
    if (settle || rescan)
      for (let i = missing.count - 1; i >= 0; i--)
        if (!awaitsClosure(records[i])) missing.remove(missing.list[i]);
    settle = rescan = false;
  };
  return {
    /** Records still awaited, their own bytes or those of their closure, and their count: the held
     *  image only reads that count. */
    get records() {
      reconcile();
      return records;
    },
    get count() {
      reconcile();
      return missing.count;
    },
    /** The difference that has just been applied: exits first, entries next. */
    apply() {
      const exits = delta.exited,
        entries = delta.entered;
      for (let i = 0; i < delta.exitedCount; i++) {
        const id = exits[i];
        if (slots[id] >= 0) missing.remove(id);
      }
      for (let i = 0; i < delta.enteredCount; i++) {
        const id = entries[i];
        const rec = packedPages[id];
        if (slots[id] < 0 && awaitsClosure(rec)) missing.add(id, rec);
      }
    },
    /** A page's bytes have just arrived or left. */
    touch(id: number) {
      const rec = packedPages[id];
      if (named[id]) {
        if (awaitsPageBytes(rec)) rescan = true;
        else settle = true;
      }
      if (!delta.has(id)) return;
      if (awaitsClosure(rec)) missing.add(id, rec);
      else missing.remove(id);
    },
  };
}
