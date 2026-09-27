import { grown } from '../../page/cut/sparseInts.ts';
import { coalesceRanges, type RangeRule } from '../residency/ranges.ts';

/**
 * Writes a page table sends at its next flush: the words that changed, in runs, never a
 * texture's whole span between two far apart. Runs closer than `JOIN_GAP` words are sent as one,
 * and past `MAX_WRITES` runs the ones across the smallest gaps are joined, so a flush makes at
 * most that many `writeBuffer` calls. Both declared, not derived: they weigh a call against the
 * bytes a joined gap resends, and change no word the GPU reads.
 */
const JOIN_GAP = 16,
  MAX_WRITES = 64;

export function createPageUploads(size: number) {
  const marked = new Uint8Array(size),
    runs = new Int32Array(MAX_WRITES * 2);
  // The changed words, and the steps between them at a flush: both reused, grown together.
  let changed = new Int32Array(64),
    count = 0;
  const rule = {
    gap: JOIN_GAP,
    cap: MAX_WRITES,
    overflow: 'narrowest',
    steps: new Int32Array(64),
  } satisfies RangeRule;
  return {
    /** Word `index` changed since the last flush. */
    mark(index: number) {
      if (marked[index]) return;
      marked[index] = 1;
      if (count === changed.length) {
        changed = grown(changed, count + 1, count);
        rule.steps = grown(rule.steps, changed.length);
      }
      changed[count++] = index;
    },
    /** Sends the changed words of `words` to `buffer`; nothing when nothing changed. */
    flush(queue: GPUQueue, buffer: GPUBuffer, words: Uint32Array<ArrayBuffer>) {
      if (!count) return;
      const sorted = changed.subarray(0, count).sort();
      for (let i = 0; i < count; i++) marked[sorted[i]] = 0;
      const writes = coalesceRanges(sorted, count, runs, rule);
      for (let r = 0; r < writes; r++) {
        const from = runs[r * 2];
        queue.writeBuffer(buffer, from * 4, words, from, runs[r * 2 + 1] - from + 1);
      }
      count = 0;
    },
  };
}
