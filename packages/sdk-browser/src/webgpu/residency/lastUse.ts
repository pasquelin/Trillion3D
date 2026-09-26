import type { PageRec } from '../../page/selection/selection.ts';
import { createSparseInts } from '../../page/cut/sparseInts.ts';
import { DAG_READBACK_SLOTS } from '../../gpu/dag/layout.ts';

/**
 * Frames a page stays held once the image stopped using it. The drawn list reaches the cache
 * through the readback slots, so the GPU may have drawn that many frames the cache has not read
 * yet, and one more is being encoded: a page unused for this many frames is unused by every frame
 * the GPU can still be drawing. The rule follows the frame pipeline, never a scene.
 */
export const LAST_USE_WINDOW = DAG_READBACK_SLOTS + 1;

/**
 * Eviction by last use, and parents after their children: which pages the image still holds once
 * it stops drawing or requesting them.
 *
 * A page the image keeps — its cut, the pinned cover, and what it draws, the nearest resident
 * ancestor standing in for a missing page included — is held. A page that leaves `keep` stays
 * held for `LAST_USE_WINDOW` frames, then is released, oldest first: the caller unpins it. It was
 * sent to the far end of the cache's order when it went idle (`onIdle`), so the cache reclaims
 * released pages in their last-use order, and ahead of the pages a lower tier moved there since
 * (`residentEnsurer.ts`), which some view still wants. Under pressure — more kept pages to load than the pool has unpinned slots — the window
 * gives way first: that many idle pages are released early, still oldest first, so the window
 * never costs the image a page it asks for. A page within its window that is still loading asks
 * for no slot: the image no longer wants it.
 *
 * A page also stays held while a held page depends on it (`parentsOf`): holding a page holds its
 * parents, and a parent its last held child lets go of starts its own window then. A parent
 * therefore never leaves before its children, and the nearest resident ancestor of a cluster is
 * never reclaimed under it.
 *
 * Its tables follow the held pages, never the catalogue (#483 rule 6), and each call walks what
 * moved and what came due, never the held set.
 */
export function createLastUse(options: {
  keyOf: (rec: PageRec) => number;
  parentsOf: (rec: PageRec) => readonly PageRec[];
  /** True while the image keeps the page. */
  kept: (key: number) => boolean;
  /** A page became held through a child: the caller pins it once resident. */
  onHeld: (key: number) => void;
  /** A page went idle, its last use: the caller moves it to the far end of the cache's order. */
  onIdle: (key: number) => void;
}) {
  const { keyOf, parentsOf, kept, onHeld, onIdle } = options;
  /** The frame, plus one, each page left `keep` at while it waits out its window. */
  const idleSince = createSparseInts();
  /** Held pages that depend on each page. */
  const children = createSparseInts();
  /** The record of each held page that holds its parents, read for them when it is released. */
  const recs = new Map<number, PageRec>();
  /** Pages in the order they went idle, beside that frame; entries a later use made stale are
   *  skipped when they come due. */
  const idleKeys: number[] = [],
    idleFrames: number[] = [];
  let head = 0;
  const idle = (key: number, frame: number) => {
    idleSince.set(key, frame + 1);
    onIdle(key);
    idleKeys.push(key);
    idleFrames.push(frame);
  };
  /** The page holds its parents, unless it already did: each counts one more held child, and a
   *  parent held for the first time holds its own. True when it did not hold them yet. */
  const hold = (key: number, rec: PageRec) => {
    if (recs.has(key)) return false;
    recs.set(key, rec);
    for (const parent of parentsOf(rec)) {
      const at = keyOf(parent);
      children.add(at, 1);
      if (hold(at, parent)) onHeld(at);
    }
    return true;
  };
  /** Releases one page; true when `onRelease` says that gave a slot back. */
  const release = (key: number, frame: number, onRelease: (key: number) => boolean) => {
    idleSince.set(key, 0);
    const rec = recs.get(key);
    recs.delete(key);
    const freed = onRelease(key);
    if (rec)
      for (const parent of parentsOf(rec)) {
        const at = keyOf(parent);
        if (children.add(at, -1) === 0 && !kept(at)) idle(at, frame);
      }
    return freed;
  };
  return {
    /** True while the page may not leave: kept, within its window, or depended on. */
    holds: (key: number) => kept(key) || idleSince.get(key) > 0 || children.get(key) > 0,
    /** The page joined `keep`: its window ends, and it holds its parents unless it already did. */
    use(key: number, rec?: PageRec) {
      idleSince.set(key, 0);
      if (rec) hold(key, rec);
    },
    /** The page left `keep` at `frame`: its window starts. */
    leave: idle,
    /** Releases, oldest first, every page idle for the window that no held page depends on, and,
     *  those still within their window included, until `pressure` slots are given back: a page
     *  whose `onRelease` frees no slot — it never arrived — does not count. */
    release(frame: number, onRelease: (key: number) => boolean, pressure = 0) {
      while (head < idleKeys.length) {
        if (frame - idleFrames[head] < LAST_USE_WINDOW && pressure <= 0) break;
        const key = idleKeys[head],
          since = idleFrames[head++];
        if (idleSince.get(key) !== since + 1 || kept(key) || children.get(key) !== 0) continue;
        if (release(key, frame, onRelease)) pressure--;
      }
      if (head === 0 || head * 2 < idleKeys.length) return;
      idleKeys.splice(0, head);
      idleFrames.splice(0, head);
      head = 0;
    },
  };
}
