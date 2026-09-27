import type { PageRec } from '../../page/selection/selection.ts';
import type { IdDelta } from '../cut/delta.ts';
import { createDenseKeySet } from '../cut/denseKeys.ts';
import { createKeyUnion } from '../cut/keyUnion.ts';
import { createBudgetRanking } from './budgetRanking.ts';
import { createHeldKeys } from '../cut/heldKeys.ts';
import type { createWebgpuPageTracking } from '../row/pageTracking.ts';

type Tracking = ReturnType<typeof createWebgpuPageTracking>;

export type WebgpuResidencySets = ReturnType<typeof createWebgpuResidencySets>;

/**
 * The sets an image decides residency with, carried from one image to the next instead of rebuilt.
 *
 * `desired` is what the image asks the cache for — the pinned cover and the cut — and `keep` adds
 * what the image draws, which the cache must not reclaim under it. The cut arrives as a DELTA from
 * either cut, so a moving camera costs the pages that changed and a still camera nothing at all.
 * `tracking.wanted`, what the upload queue walks, is the desired set unless the budget cuts it.
 */
export function createWebgpuResidencySets(options: {
  tracking: Tracking;
  bootstrapKey: Uint8Array;
  packedPages: readonly PageRec[];
  /** Visits every page the cut closes over (`../../page/cut/groupClosure.ts`). */
  heldIds?: (visit: (id: number) => void) => void;
}) {
  const { tracking, bootstrapKey, packedPages } = options;
  const { keyCount, keyOf, wanted, wantedPages } = tracking;
  /** A packed page's cache key, cached on its record by the tracking (`PageRec.keyIndex`). */
  const keyOfId = (id: number) => keyOf(packedPages[id]);
  /** What joined and left `keep` since the pin step last ran, each joining key beside the record
   *  it joined by (none for the pinned cover): the pin step reads its parents there. */
  const enteringPages: (PageRec | undefined)[] = [];
  const entering = createDenseKeySet(enteringPages),
    leaving = createDenseKeySet();
  /** The CPU cut ranks by level; the GPU cut admits by its requests (`requestAdmission.ts`) and
   *  feeds no ranking (#836). */
  let cpuCut = true;
  const desiredPages: PageRec[] = [];
  const desired = createDenseKeySet(desiredPages);
  const ranking = createBudgetRanking({ bootstrapKey, keyOf });
  let followsDesired = true;
  const requested = createKeyUnion({
    members: desired,
    keyCount,
    covered: bootstrapKey,
    onListed: (key, page) => {
      if (followsDesired) enqueue(key, page);
    },
    onUnlisted: (key) => {
      if (followsDesired) dequeue(key);
    },
  });
  const keep = createKeyUnion({
    members: tracking.keep,
    keyCount,
    onListed: (key, page) => {
      leaving.remove(key);
      entering.add(key, page);
    },
    onUnlisted: (key) => {
      entering.remove(key);
      leaving.add(key);
    },
  });
  let cover = 0;
  for (let key = 0; key < keyCount; key++)
    if (bootstrapKey[key]) {
      keep.retain(key);
      cover++;
    }
  /** Entering the upload queue is what makes the image hold a page; leaving it lets the page go. */
  /** Bumped whenever the upload queue changes, so what `accepts` answers may have changed. */
  let acceptedRevision = 0;
  const enqueue = (key: number, page?: PageRec) => {
    if (!wanted.add(key, page)) return;
    acceptedRevision++;
    keep.retain(key, page);
  };
  const dequeue = (key: number) => {
    if (!wanted.remove(key)) return;
    acceptedRevision++;
    keep.release(key);
  };
  /** What the cut asks the cache for, and what the image actually draws. The second is not a subset
   *  of the first: a cluster whose replacement is missing is drawn from a resident ancestor the cut
   *  never asked for, and the cache must not reclaim it while it is on screen. */
  const askedKeys = createHeldKeys({
    keyOf: keyOfId,
    retain: (key, id) => requested.retain(key, packedPages[id]),
    release: (key) => requested.release(key),
    onEnter: (id) => cpuCut && ranking.add(packedPages[id]),
    onExit: (id) => cpuCut && ranking.remove(packedPages[id]),
  });
  const drawnKeys = createHeldKeys({
    keyOf: keyOfId,
    retain: (key: number, id: number) => keep.retain(key, packedPages[id]),
    release: (key: number) => keep.release(key),
  });
  /** Makes the queue the first `count` of `keys`, beside their records: the new holds are taken
   *  before the old ones are let go of, so a key in both never leaves `keep` (#477). */
  const refill = (keys: Int32Array, pages: readonly PageRec[], count: number) => {
    for (let i = 0; i < count; i++) keep.retain(keys[i], pages[i]);
    for (let i = wanted.count - 1; i >= 0; i--) keep.release(wanted.list[i]);
    wanted.clear();
    acceptedRevision++;
    for (let i = 0; i < count; i++) wanted.add(keys[i], pages[i]);
  };
  /** The queue follows the cut whole: every page it asks for fits the pool. */
  const followDesired = () => {
    if (followsDesired) return;
    followsDesired = true;
    refill(desired.list, desiredPages, desired.count);
  };
  /** Makes the queue the first `count` of `keys`; the same keys reordered hold nothing anew. */
  const admit = (keys: Int32Array, pages: readonly PageRec[], count: number) => {
    followsDesired = false;
    let same = count === wanted.count,
      inOrder = same;
    for (let i = 0; same && i < count; i++) {
      same = wanted.has(keys[i]);
      inOrder &&= wanted.list[i] === keys[i] && wantedPages[i] === pages[i];
    }
    if (!same) return refill(keys, pages, count);
    if (inOrder) return;
    wanted.clear();
    for (let i = 0; i < count; i++) wanted.add(keys[i], pages[i]);
  };
  return {
    entering,
    enteringPages,
    leaving,
    /** Keys the cut asks for beyond the pinned cover. */
    get desiredCount() {
      return desired.count;
    },
    /** True while the queue is the cut whole: the budget refused none of it. */
    get cutFits() {
      return followsDesired;
    },
    /** Keys the image holds outside the queue and the cover: what it draws with what that needs. */
    get heldOutsideQueue() {
      return tracking.keep.count - wanted.count - cover;
    },
    /** The cut that decides; true on a switch. The CPU cut's ranking refills from the closed cut,
     *  and its pin step, started afresh, sees every kept key join. */
    decideBy(cpu: boolean) {
      if (cpu === cpuCut) return false;
      cpuCut = cpu;
      entering.clear();
      leaving.clear();
      ranking.clear();
      if (!cpu) return true;
      const { list, count } = tracking.keep;
      for (let i = 0; i < count; i++) entering.add(list[i], tracking.keepPages[i]);
      options.heldIds?.((id) => ranking.add(packedPages[id]));
      return true;
    },
    followDesired,
    admit,
    /** Keys this image asks the cache for, the pinned cover included. */
    get requestedCount() {
      return requested.size;
    },
    /** Keys this image forbids the cache to reclaim: what it asks for plus what it draws. */
    get keepCount() {
      return tracking.keep.count;
    },
    /** Bytes of every set above and of the tracking's: they follow what the image asks for, holds
     *  and draws, never the catalogue (#483 rule 6). */
    get hostBytes() {
      return (
        entering.byteLength +
        leaving.byteLength +
        requested.byteLength +
        keep.byteLength +
        askedKeys.byteLength +
        drawnKeys.byteLength +
        ranking.byteLength +
        wanted.byteLength +
        tracking.pinned.byteLength
      );
    },
    /** Changes whenever `accepts` may answer differently. */
    get acceptedRevision() {
      return acceptedRevision;
    },
    /** True when this image asks the cache for the key, even past the page budget. */
    requests: (key: number) => desired.has(key),
    /** True when the pool accepted the page: the pinned cover, or the upload queue within the page
     *  budget. A page past the budget is drawn by its nearest resident ancestor and never awaited. */
    accepts: (page: PageRec) => {
      const key = keyOf(page);
      return bootstrapKey[key] === 1 || wanted.has(key);
    },
    /** Applies one difference of what the cut asks for — its pages and the groups they close over
     *  (`../../page/cut/groupClosure.ts`): only the pages that entered and left are touched. */
    applyCut(delta: IdDelta) {
      askedKeys.apply(delta);
    },
    /** Applies one difference of the drawable cut, which is what the image must not lose. */
    applyDrawn(delta: IdDelta) {
      drawnKeys.apply(delta);
    },
    /**
     * The CPU cut's budget: the upload queue holds `room` records. A cut that fits is the queue, and
     * the incremental set already is that queue. One that does not is ranked coarsest first and cut
     * to `room`: a complete cover plus as much detail as fits. Ranking reads the keys filed by
     * level, walking the budget, never the cut.
     */
    applyBudget(room: number) {
      if (ranking.rank(room) <= room) {
        followDesired();
        return false;
      }
      admit(ranking.keys, ranking.ranked, ranking.length);
      return true;
    },
    wantedPages,
  };
}
