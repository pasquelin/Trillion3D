import type { PageRec } from './pageSelection.ts';
import type { CutDelta } from './webgpuCutDelta.ts';
import { createDenseKeySet } from './webgpuDenseKeys.ts';
import { createKeyUnion } from './webgpuKeyUnion.ts';
import { createBudgetRanking } from './webgpuBudgetRanking.ts';
import { createHeldKeys } from './webgpuHeldKeys.ts';
import type { createWebgpuPageTracking } from './webgpuPageTracking.ts';

type Tracking = ReturnType<typeof createWebgpuPageTracking>;

export type WebgpuResidencySets = ReturnType<typeof createWebgpuResidencySets>;

/**
 * The sets an image decides residency with, carried from one image to the next instead of rebuilt.
 *
 * `desired` is what the image asks the cache for — the pinned cover and the cut — and `keep` adds
 * what the image draws, which the cache must not reclaim under it. La coupe arrive comme une
 * DIFFÉRENCE, qu'elle vienne du relevé de la carte ou de la coupe processeur : un même contrat pour
 * les deux, si bien qu'une caméra qui bouge coûte les pages qui ont changé et une caméra immobile
 * rien du tout. `tracking.wanted` is what the upload queue walks: the desired set itself, unless the
 * page budget forces the coarser subset `applyBudget` computes.
 */
export function createWebgpuResidencySets(options: {
  tracking: Tracking;
  bootstrapKey: Uint8Array;
  packedPages: readonly PageRec[];
}) {
  const { tracking, bootstrapKey, packedPages } = options;
  const { keyCount, keyOf, wanted, wantedPages } = tracking;
  const keyOfPageId = new Int32Array(Math.max(1, packedPages.length));
  for (let id = 0; id < packedPages.length; id++) keyOfPageId[id] = keyOf(packedPages[id]);
  /** What joined and left `keep` since the pin step last ran. */
  const entering = createDenseKeySet(keyCount),
    leaving = createDenseKeySet(keyCount);
  const desiredPages: PageRec[] = [];
  const desired = createDenseKeySet(keyCount, desiredPages);
  const ranking = createBudgetRanking({ keyCount, bootstrapKey, keyOf });
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
    onListed: (key) => {
      leaving.remove(key);
      entering.add(key);
    },
    onUnlisted: (key) => {
      entering.remove(key);
      leaving.add(key);
    },
  });
  for (let key = 0; key < keyCount; key++) if (bootstrapKey[key]) keep.retain(key);
  /** Entering the upload queue is what makes the image hold a page; leaving it lets the page go. */
  const enqueue = (key: number, page?: PageRec) => {
    if (wanted.add(key, page)) keep.retain(key);
  };
  const dequeue = (key: number) => {
    if (wanted.remove(key)) keep.release(key);
  };
  const askFor = (key: number, page?: PageRec) => requested.retain(key, page);
  const dropAsk = (key: number) => requested.release(key);
  const holdDrawn = (key: number) => keep.retain(key);
  const dropDrawn = (key: number) => keep.release(key);
  /** What the cut asks the cache for, and what the image actually draws. The second is not a subset
   *  of the first: a cluster whose replacement is missing is drawn from a resident ancestor the cut
   *  never asked for, and the cache must not reclaim it while it is on screen. */
  const askedKeys = createHeldKeys({
    keyCount,
    keyOfPageId,
    retain: (key, id) => askFor(key, packedPages[id]),
    release: dropAsk,
    onEnter: (id) => ranking.add(packedPages[id]),
    onExit: (id) => ranking.remove(packedPages[id]),
  });
  const drawnKeys = createHeldKeys({
    keyCount,
    keyOfPageId,
    retain: holdDrawn,
    release: dropDrawn,
  });
  /** Empties the queue, releasing every hold it placed. */
  const emptyQueue = () => {
    for (let i = wanted.count - 1; i >= 0; i--) keep.release(wanted.list[i]);
    wanted.clear();
  };
  const restoreWanted = () => {
    followsDesired = true;
    emptyQueue();
    for (let i = 0; i < desired.count; i++) enqueue(desired.list[i], desiredPages[i]);
  };
  return {
    entering,
    leaving,
    /** Keys this image asks the cache for, the pinned cover included. */
    get requestedCount() {
      return requested.size;
    },
    /** Keys this image forbids the cache to reclaim: what it asks for plus what it draws. */
    get keepCount() {
      return tracking.keep.count;
    },
    /** Applies one cut difference: only the pages that entered and left are touched. */
    applyCut(delta: CutDelta) {
      askedKeys.apply(delta);
    },
    /** Applies one difference of the drawable cut, which is what the image must not lose. */
    applyDrawn(delta: CutDelta) {
      drawnKeys.apply(delta);
    },
    /**
     * The upload queue holds `room` records. A cut that fits is the queue, and the incremental set
     * already is that queue — nothing is walked. A cut that does not fit is ranked coarsest first and
     * cut to `room`: coarse clusters cover more surface per slot, so what survives is a complete
     * cover plus as much detail as fits, never a truncated cut of the surface. Le classement lit les
     * clés pesées rangées par niveau : il ne parcourt pas la coupe, seulement le budget.
     *
     * A cut that ranks to the queue already held changes nothing, so nothing is written, and the
     * queue is rebuilt only where the two differ.
     */
    applyBudget(room: number) {
      if (ranking.rank(room) <= room) {
        if (!followsDesired) restoreWanted();
        return false;
      }
      followsDesired = false;
      if (ranking.matches(wanted.list, wanted.count, wantedPages)) return true;
      emptyQueue();
      for (let i = 0; i < ranking.length; i++) enqueue(ranking.keys[i], ranking.ranked[i]);
      return true;
    },
    wantedPages,
  };
}
