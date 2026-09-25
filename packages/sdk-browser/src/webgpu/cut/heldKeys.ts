import type { IdDelta } from './delta.ts';
import { createSparseInts } from '../../page/cut/sparseInts.ts';

/**
 * The keys one cut holds, counted per placement.
 *
 * Several placements of one page share a single cache key, so a key is retained once and released
 * when the last placement that named it leaves. The cut arrives as a difference — the pages that
 * entered and left since the previous one — so an image that moves no page touches nothing here,
 * whatever the cut is worth.
 */
export function createHeldKeys(options: {
  /** The cache key of packed page `id`. */
  keyOf: (id: number) => number;
  retain: (key: number, id: number) => void;
  release: (key: number) => void;
  onEnter?: (id: number) => void;
  onExit?: (id: number) => void;
}) {
  const { keyOf, retain, release, onEnter, onExit } = options;
  // The reference count IS membership: a count above zero says exactly "this key is held". A
  // list beside it would say nothing more, and would be paid on each key that enters or leaves,
  // every frame. Counts are held for the held keys only: the view's, never the catalogue's.
  const refs = createSparseInts();
  return {
    get byteLength() {
      return refs.byteLength;
    },
    apply(delta: IdDelta) {
      for (let i = 0; i < delta.exitedCount; i++) {
        const id = delta.exited[i],
          key = keyOf(id);
        onExit?.(id);
        if (refs.add(key, -1) > 0) continue;
        release(key);
      }
      for (let i = 0; i < delta.enteredCount; i++) {
        const id = delta.entered[i],
          key = keyOf(id);
        onEnter?.(id);
        if (refs.add(key, 1) > 1) continue;
        retain(key, id);
      }
    },
  };
}
