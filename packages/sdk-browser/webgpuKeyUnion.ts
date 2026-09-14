import type { PageRec } from './pageSelection.ts';
import type { DenseKeySet } from './webgpuDenseKeys.ts';
import { createDenseKeySet } from './webgpuDenseKeys.ts';

export type KeyRetain = (key: number, page?: PageRec) => void;
export type KeyRelease = (key: number) => void;

/**
 * The union of several sources of page keys, held from one image to the next. A source holds a key at
 * most once, the union counts it once however many sources hold it, and a source therefore changes it
 * by difference alone. Keys marked `covered` — the pinned root cover, which every image asks for —
 * count towards `size` but stay out of `members`, so `members` lists exactly what the residency queue
 * still has to fetch. `onListed`/`onUnlisted` report the moment a key joins or leaves the union, which
 * is what the pin bookkeeping needs and all it needs.
 */
export function createKeyUnion(options: {
  members: DenseKeySet;
  keyCount: number;
  covered?: Uint8Array;
  onListed?: (key: number, page?: PageRec) => void;
  onUnlisted?: (key: number) => void;
}) {
  const { members, keyCount, covered, onListed, onUnlisted } = options;
  const refs = new Int32Array(Math.max(1, keyCount));
  let coveredCount = 0;
  if (covered) for (let key = 0; key < keyCount; key++) if (covered[key]) coveredCount++;
  return {
    members,
    /** Keys the union holds, the covered cover included. */
    get size() {
      return coveredCount + members.count;
    },
    retain(key: number, page?: PageRec) {
      if (refs[key]++ > 0 || covered?.[key]) return;
      members.add(key, page);
      onListed?.(key, page);
    },
    release(key: number) {
      if (refs[key] <= 0) return;
      if (--refs[key] > 0 || covered?.[key]) return;
      members.remove(key);
      onUnlisted?.(key);
    },
    /** Empties every source at once; the caller re-retains what the image still asks for. */
    reset() {
      for (let i = members.count - 1; i >= 0; i--) onUnlisted?.(members.list[i]);
      members.clear();
      refs.fill(0);
    },
  };
}

/**
 * A source whose members the image re-reads in full — the transparent cut, which no GPU readback
 * describes, and the whole cut when the CPU path takes over. Comparing what it reads against what it
 * held costs one pass over the list it was handed, and the unions still only ever see the difference.
 */
export function createRefreshedKeys(keyCount: number, retain: KeyRetain, release: KeyRelease) {
  const held = createDenseKeySet(keyCount);
  const stamp = new Int32Array(Math.max(1, keyCount)).fill(-1);
  const dropped: number[] = [];
  let epoch = 0;
  return {
    held,
    refresh(pages: readonly PageRec[], keyOf: (page: PageRec) => number) {
      epoch++;
      for (let i = 0; i < pages.length; i++) {
        const page = pages[i],
          key = keyOf(page);
        if (stamp[key] === epoch) continue;
        stamp[key] = epoch;
        if (held.add(key)) retain(key, page);
      }
      dropped.length = 0;
      for (let i = held.count - 1; i >= 0; i--) {
        const key = held.list[i];
        if (stamp[key] !== epoch) dropped.push(key);
      }
      for (let i = 0; i < dropped.length; i++) {
        held.remove(dropped[i]);
        release(dropped[i]);
      }
    },
    /** Forgets what the source held; a union already reset simply ignores the releases. */
    clear() {
      for (let i = held.count - 1; i >= 0; i--) release(held.list[i]);
      held.clear();
    },
  };
}
