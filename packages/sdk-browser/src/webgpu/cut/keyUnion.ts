import type { PageRec } from '../../page/selection/selection.ts';
import type { DenseKeySet } from './denseKeys.ts';
import { createSparseInts } from '../../page/cut/sparseInts.ts';

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
  /** Holders per key, only for the keys held: the union follows the view, not the catalogue. */
  const refs = createSparseInts();
  let coveredCount = 0;
  if (covered) for (let key = 0; key < keyCount; key++) if (covered[key]) coveredCount++;
  return {
    members,
    /** Keys the union holds, the covered cover included. */
    get size() {
      return coveredCount + members.count;
    },
    /** Bytes of the holder counts and of `members`. */
    get byteLength() {
      return refs.byteLength + members.byteLength;
    },
    retain(key: number, page?: PageRec) {
      if (refs.add(key, 1) > 1 || covered?.[key]) return;
      members.add(key, page);
      onListed?.(key, page);
    },
    release(key: number) {
      if (refs.get(key) <= 0) return;
      if (refs.add(key, -1) > 0 || covered?.[key]) return;
      members.remove(key);
      onUnlisted?.(key);
    },
  };
}
