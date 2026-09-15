import type { CutDelta } from './webgpuCutDelta.ts';
import { createDenseKeySet } from './webgpuDenseKeys.ts';

/**
 * The keys one cut holds, counted per placement.
 *
 * Several placements of one page share a single cache key, so a key is retained once and released
 * when the last placement that named it leaves. The cut arrives as a difference — the pages that
 * entered and left since the previous one — so an image that moves no page touches nothing here,
 * whatever the cut is worth.
 */
export function createHeldKeys(options: {
  keyCount: number;
  keyOfPageId: Int32Array;
  retain: (key: number, id: number) => void;
  release: (key: number) => void;
  onEnter?: (id: number) => void;
  onExit?: (id: number) => void;
}) {
  const { keyCount, keyOfPageId, retain, release, onEnter, onExit } = options;
  const refs = new Int32Array(Math.max(1, keyCount));
  const held = createDenseKeySet(keyCount);
  return {
    get count() {
      return held.count;
    },
    apply(delta: CutDelta) {
      for (let i = 0; i < delta.exitedCount; i++) {
        const id = delta.exited[i],
          key = keyOfPageId[id];
        onExit?.(id);
        if (--refs[key] > 0) continue;
        held.remove(key);
        release(key);
      }
      for (let i = 0; i < delta.enteredCount; i++) {
        const id = delta.entered[i],
          key = keyOfPageId[id];
        onEnter?.(id);
        if (refs[key]++ > 0) continue;
        held.add(key);
        retain(key, id);
      }
    },
    /** Lets everything go at once: the cut this index described no longer decides the image. */
    clear() {
      for (let i = held.count - 1; i >= 0; i--) {
        const key = held.list[i];
        refs[key] = 0;
        release(key);
      }
      held.clear();
    },
  };
}
