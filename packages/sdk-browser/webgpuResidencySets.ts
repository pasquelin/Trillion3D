import type { PageRec } from './pageSelection.ts';
import type { CutDelta } from './webgpuCutDelta.ts';
import { createDenseKeySet } from './webgpuDenseKeys.ts';
import { createKeyUnion, createRefreshedKeys } from './webgpuKeyUnion.ts';
import { createBudgetRanking } from './webgpuBudgetRanking.ts';
import type { createWebgpuPageTracking } from './webgpuPageTracking.ts';

type Tracking = ReturnType<typeof createWebgpuPageTracking>;

export type WebgpuResidencySets = ReturnType<typeof createWebgpuResidencySets>;

/**
 * The sets an image decides residency with, carried from one image to the next instead of rebuilt.
 *
 * `desired` is what the image asks the cache for — the pinned cover, the opaque cut and the
 * transparent cut — and `keep` adds what the image draws, which the cache must not reclaim under it.
 * The opaque cut arrives as a difference from the GPU readback, the transparent cut as a short list
 * the image re-reads, so a moving camera costs the pages that changed and a still one costs nothing.
 * `tracking.wanted` is what the upload queue walks: the desired set itself, unless the page budget
 * forces the coarser subset `applyBudget` computes.
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
  const transparentWanted = createRefreshedKeys(keyCount, askFor, dropAsk);
  const transparentShown = createRefreshedKeys(keyCount, holdDrawn, dropDrawn);
  const cpuWanted = createRefreshedKeys(keyCount, askFor, dropAsk);
  const cpuShown = createRefreshedKeys(keyCount, holdDrawn, dropDrawn);
  /** Keys the opaque cut holds, counted per key: several placements of one page share one key. */
  const opaqueRefs = new Int32Array(keyCount);
  const opaqueHeld = createDenseKeySet(keyCount);
  const dropOpaque = (id: number) => {
    const key = keyOfPageId[id];
    ranking.remove(packedPages[id]);
    if (--opaqueRefs[key] > 0) return;
    opaqueHeld.remove(key);
    dropAsk(key);
  };
  const clearOpaque = () => {
    for (let i = opaqueHeld.count - 1; i >= 0; i--) {
      const key = opaqueHeld.list[i];
      opaqueRefs[key] = 0;
      dropAsk(key);
    }
    opaqueHeld.clear();
    ranking.clear();
  };
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
    /** Applies one GPU cut difference: only the pages that entered and left are touched. */
    applyCut(delta: CutDelta) {
      for (let i = 0; i < delta.exitedCount; i++) dropOpaque(delta.exited[i]);
      for (let i = 0; i < delta.enteredCount; i++) {
        const id = delta.entered[i],
          key = keyOfPageId[id];
        ranking.add(packedPages[id]);
        if (opaqueRefs[key]++ > 0) continue;
        opaqueHeld.add(key);
        askFor(key, packedPages[id]);
      }
    },
    refreshTransparentWanted(pages: readonly PageRec[]) {
      transparentWanted.refresh(pages, keyOf);
    },
    refreshTransparentShown(pages: readonly PageRec[]) {
      transparentShown.refresh(pages, keyOf);
    },
    /**
     * The CPU cut owns the whole set for as long as it drives the image: it hands over its wanted and
     * drawn lists in full, and the GPU cut re-seeds from nothing when it takes over again.
     */
    refreshCpu(wantedNow: readonly PageRec[], shownNow: readonly PageRec[]) {
      if (opaqueHeld.count) clearOpaque();
      transparentWanted.clear();
      transparentShown.clear();
      if (!followsDesired) restoreWanted();
      cpuWanted.refresh(wantedNow, keyOf);
      cpuShown.refresh(shownNow, keyOf);
    },
    /** Hands the opaque and transparent cuts back the sets the CPU cut held. */
    releaseCpu() {
      if (!cpuWanted.held.count && !cpuShown.held.count) return;
      cpuWanted.clear();
      cpuShown.clear();
    },
    /**
     * The upload queue holds `room` records. A cut that fits is the queue, and the incremental set
     * already is that queue — nothing is walked. A cut that does not fit is ranked coarsest first and
     * cut to `room`: coarse clusters cover more surface per slot, so what survives is a complete
     * cover plus as much detail as fits, never a truncated cut of the surface. Ranking needs the cut
     * in the order the readback published it, which is the order `desiredNow` is written in.
     *
     * A cut that ranks to the queue already held changes nothing, so nothing is written: the ranking
     * is recomputed from the records themselves every image, never assumed from the cut standing
     * still, and the queue is rebuilt only where the two differ.
     */
    applyBudget(room: number, desiredNow: readonly PageRec[], transparentNow: readonly PageRec[]) {
      if (ranking.rank(room, desiredNow, transparentNow) <= room) {
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
