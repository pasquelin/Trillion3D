import { createChangedRuns } from '../residency/ranges.ts'
import { PAGE_TABLE_RULE } from './pageTableRule.ts'

export function createPageUploads(size: number) {
  const changed = createChangedRuns(size, PAGE_TABLE_RULE.gap, PAGE_TABLE_RULE.cap)
  return {
    /** Word `index` changed since the last flush. */
    mark: changed.mark,
    /** Sends the changed words of `words` to `buffer`; nothing when nothing changed. */
    flush(queue: GPUQueue, buffer: GPUBuffer, words: Uint32Array<ArrayBuffer>) {
      if (!changed.count) return
      const { count, pairs } = changed.runs()
      for (let r = 0; r < count; r++) {
        const from = pairs[r * 2]
        queue.writeBuffer(buffer, from * 4, words, from, pairs[r * 2 + 1] - from + 1)
      }
      changed.clear()
    },
  }
}
