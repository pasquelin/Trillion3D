import type { PageRec } from './pageSelection.ts';
import { createDenseKeySet } from './webgpuDenseKeys.ts';

export type CutDelta = ReturnType<typeof createCutDelta>;

/**
 * The opaque cut as a set that outlives the image: given the page ids the GPU published, it names the
 * pages that entered and left since the previous cut and keeps `pages` — the dense record array the
 * caller owns — in step, so every consumer downstream reads a difference instead of a list.
 *
 * `pages` holds the cut in its first `count` entries; whatever the caller appended after them (the
 * transparent cut, which the GPU never selects) is dropped on every update and re-appended by the
 * caller. Nothing is allocated once the scene is known: the two difference lists and the membership
 * index are sized to the page count at construction.
 */
export function createCutDelta(packedPages: readonly PageRec[], pages: PageRec[]) {
  const capacity = Math.max(1, packedPages.length);
  const members = createDenseKeySet(capacity);
  const stamp = new Int32Array(capacity).fill(-1);
  const entered = new Int32Array(capacity),
    exited = new Int32Array(capacity);
  let epoch = 0,
    enteredCount = 0,
    exitedCount = 0,
    seeded = false;
  /** Drops the caller's suffix and reports no difference: the cut is the one already held. */
  const hold = () => {
    pages.length = members.count;
    enteredCount = 0;
    exitedCount = 0;
  };
  return {
    entered,
    exited,
    get enteredCount() {
      return enteredCount;
    },
    get exitedCount() {
      return exitedCount;
    },
    get count() {
      return members.count;
    },
    hold,
    /** Forgets the cut: the next update re-enters every page, as the first one does. */
    invalidate() {
      members.clear();
      seeded = false;
      enteredCount = 0;
      exitedCount = 0;
    },
    /** Difference between `ids` and the cut held, applied to the membership and to `pages`. */
    apply(ids: readonly number[]) {
      epoch++;
      enteredCount = 0;
      exitedCount = 0;
      if (!seeded) {
        // The caller seeded `pages` with a cover this index knows nothing about: start from nothing.
        pages.length = 0;
        members.clear();
        seeded = true;
      } else pages.length = members.count;
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        if (id < 0 || id >= capacity || stamp[id] === epoch || !packedPages[id]) continue;
        stamp[id] = epoch;
        if (!members.has(id)) entered[enteredCount++] = id;
      }
      for (let i = members.count - 1; i >= 0; i--) {
        const id = members.list[i];
        if (stamp[id] !== epoch) exited[exitedCount++] = id;
      }
      for (let i = 0; i < exitedCount; i++) {
        const id = exited[i],
          index = members.indexOf(id);
        members.remove(id);
        pages[index] = pages[members.count];
      }
      pages.length = members.count;
      for (let i = 0; i < enteredCount; i++) {
        const id = entered[i];
        members.add(id);
        pages.push(packedPages[id]);
      }
    },
  };
}
