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
 * held for `window` frames, then is released, oldest first: the caller unpins it and sends it to
 * the far end of the cache's order, so the cache reclaims released pages in their last-use order.
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
  /** A page not kept became held through a child: the caller pins it once resident. */
  onHeld: (key: number) => void;
  window?: number;
}) {
  const { keyOf, parentsOf, kept, onHeld, window = LAST_USE_WINDOW } = options;
  /** The frame, plus one, each page left `keep` at while it waits out its window. */
  const idleSince = createSparseInts();
  /** Held pages that depend on each page. */
  const children = createSparseInts();
  /** The record of each held page, read for its parents when it is released. */
  const recs = new Map<number, PageRec>();
  /** Pages in the order they went idle, beside that frame; entries a later use made stale are
   *  skipped when they come due. */
  const idleKeys: number[] = [],
    idleFrames: number[] = [];
  let head = 0;
  const waits = (key: number) => idleSince.get(key) > 0 || children.get(key) > 0;
  const idle = (key: number, frame: number) => {
    idleSince.set(key, frame + 1);
    idleKeys.push(key);
    idleFrames.push(frame);
  };
  /** A page became held: each of its parents counts one more held child. */
  const holdParents = (rec: PageRec) => {
    for (const parent of parentsOf(rec)) {
      const key = keyOf(parent);
      if (children.add(key, 1) > 1 || kept(key) || idleSince.get(key) > 0) continue;
      recs.set(key, parent);
      onHeld(key);
      holdParents(parent);
    }
  };
  const release = (key: number, frame: number, onRelease: (key: number) => void) => {
    idleSince.set(key, 0);
    const rec = recs.get(key);
    recs.delete(key);
    onRelease(key);
    if (!rec) return;
    for (const parent of parentsOf(rec)) {
      const at = keyOf(parent);
      if (children.add(at, -1) === 0 && !kept(at)) idle(at, frame);
    }
  };
  return {
    /** True while the page may not leave: kept, within its window, or depended on. */
    holds: (key: number) => kept(key) || waits(key),
    /** The page joined `keep`: its window ends, and it holds its parents unless it already did. */
    use(key: number, rec?: PageRec) {
      const held = waits(key);
      idleSince.set(key, 0);
      if (held || !rec) return;
      recs.set(key, rec);
      holdParents(rec);
    },
    /** The page left `keep` at `frame`: its window starts. */
    leave: idle,
    /** Releases, oldest first, every page idle for the window that no held page depends on. */
    release(frame: number, onRelease: (key: number) => void) {
      while (head < idleKeys.length && frame - idleFrames[head] >= window) {
        const key = idleKeys[head],
          since = idleFrames[head++];
        if (idleSince.get(key) === since + 1 && !kept(key) && children.get(key) === 0)
          release(key, frame, onRelease);
      }
      if (head * 2 < idleKeys.length) return;
      idleKeys.splice(0, head);
      idleFrames.splice(0, head);
      head = 0;
    },
  };
}
