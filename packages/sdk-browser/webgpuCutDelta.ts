import type { PageRec } from './pageSelection.ts';
import { createDenseKeySet } from './webgpuDenseKeys.ts';

export type CutDelta = ReturnType<typeof createCutDelta>;

/**
 * The opaque cut as a set that outlives the image: given the page ids the GPU published, it names the
 * pages that entered and left since the previous cut, so every consumer downstream reads a difference
 * instead of a list.
 *
 * `pages` — the record array the caller owns — is written in the order the readback published, which
 * is the order the page budget ranks and the host streams in; whatever the caller appended after the
 * cut (the transparent cut, which the GPU never selects) is dropped on every update and re-appended
 * by the caller. Nothing is allocated once the scene is known: the two difference lists and the
 * membership index are sized to the page count at construction, and an image that adopts the cut it
 * already holds writes nothing at all.
 */
export function createCutDelta(packedPages: readonly PageRec[], pages: PageRec[]) {
  const capacity = Math.max(1, packedPages.length);
  const members = createDenseKeySet(capacity);
  const stamp = new Int32Array(capacity).fill(-1);
  const entered = new Int32Array(capacity),
    exited = new Int32Array(capacity);
  let epoch = 0,
    enteredCount = 0,
    exitedCount = 0;
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
    /** Drops the caller's suffix and reports no difference: the cut is the one already held. */
    hold() {
      pages.length = members.count;
      enteredCount = 0;
      exitedCount = 0;
    },
    /** Forgets the cut held: the CPU cut rewrote the records this index describes. */
    invalidate() {
      members.clear();
      enteredCount = 0;
      exitedCount = 0;
    },
    /** Difference between `ids` and the cut held, and `pages` rewritten in the order of `ids`. */
    apply(ids: readonly number[]) {
      epoch++;
      enteredCount = 0;
      exitedCount = 0;
      pages.length = 0;
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        if (id < 0 || id >= capacity || stamp[id] === epoch || !packedPages[id]) continue;
        stamp[id] = epoch;
        pages.push(packedPages[id]);
        if (!members.has(id)) entered[enteredCount++] = id;
      }
      for (let i = members.count - 1; i >= 0; i--) {
        const id = members.list[i];
        if (stamp[id] !== epoch) exited[exitedCount++] = id;
      }
      for (let i = 0; i < exitedCount; i++) members.remove(exited[i]);
      for (let i = 0; i < enteredCount; i++) members.add(entered[i]);
    },
  };
}
