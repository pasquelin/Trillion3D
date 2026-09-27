import { grown } from '../../page/cut/sparseInts.ts';

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
  const marked = new Uint8Array(size);
  // The changed words, and the gaps between their runs at a flush: both reused, grown together.
  let changed = new Int32Array(64),
    gaps = new Int32Array(64),
    count = 0;
  return {
    /** Word `index` changed since the last flush. */
    mark(index: number) {
      if (marked[index]) return;
      marked[index] = 1;
      if (count === changed.length) {
        changed = grown(changed, count + 1, count);
        gaps = grown(gaps, changed.length);
      }
      changed[count++] = index;
    },
    /** Sends the changed words of `words` to `buffer`; nothing when nothing changed. */
    flush(queue: GPUQueue, buffer: GPUBuffer, words: Uint32Array<ArrayBuffer>) {
      if (!count) return;
      const sorted = changed.subarray(0, count).sort();
      // The largest step between two changed words still sent in one write: `JOIN_GAP`, or more
      // to keep at most `MAX_WRITES` writes.
      let join = JOIN_GAP,
        far = 0;
      for (let i = 1; i < count; i++)
        if (sorted[i] - sorted[i - 1] > join) gaps[far++] = sorted[i] - sorted[i - 1];
      if (far >= MAX_WRITES) join = gaps.subarray(0, far).sort()[far - MAX_WRITES];
      let from = sorted[0];
      for (let i = 1; i <= count; i++) {
        marked[sorted[i - 1]] = 0;
        if (i < count && sorted[i] - sorted[i - 1] <= join) continue;
        const to = sorted[i - 1];
        queue.writeBuffer(buffer, from * 4, words, from, to - from + 1);
        if (i < count) from = sorted[i];
      }
      count = 0;
    },
  };
}
