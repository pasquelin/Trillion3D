import { grownLength } from '../../../math/src/sequence/resized.ts'

/** A range of a table, `count` units from `first`. */
type Span = { first: number; count: number }

/**
 * The allocator of one table of the run-time proxy's arena (`runtimeLayout.ts`): ranges of units,
 * first fit among the freed ones, else the end of the used part. A freed range joins its neighbours,
 * and the used part shrinks back over a free tail, so a table that is emptied and filled again keeps
 * its size. `take` answers where the range starts, or `undefined` when the table would have to be
 * longer than `capacity` — the owner then grows it (`grown`) and asks again.
 */
export function createSpans(initial: number) {
  let capacity = initial,
    end = 0
  const free: Span[] = []
  return {
    get capacity() {
      return capacity
    },
    take(count: number): number | undefined {
      if (count === 0) return end
      const at = free.findIndex((span) => span.count >= count)
      if (at >= 0) {
        const span = free[at],
          first = span.first
        if (span.count === count) free.splice(at, 1)
        else {
          span.first += count
          span.count -= count
        }
        return first
      }
      if (end + count > capacity) return undefined
      end += count
      return end - count
    },
    release(first: number, count: number) {
      if (count === 0) return
      let at = free.findIndex((span) => span.first > first)
      if (at < 0) at = free.length
      free.splice(at, 0, { first, count })
      const merged: Span[] = []
      for (const span of free) {
        const last = merged[merged.length - 1]
        if (last && last.first + last.count === span.first) last.count += span.count
        else merged.push({ ...span })
      }
      free.length = 0
      free.push(...merged)
      const tail = free[free.length - 1]
      if (tail && tail.first + tail.count === end) {
        end = tail.first
        free.pop()
      }
    },
    /** The table is laid out for at least `count` units from now on, by the one growth rule
     *  (`grownLength`): twice what it held at least. */
    grown(count: number) {
      if (capacity < count) capacity = grownLength(capacity, count)
    },
    /** Units of the used part, free ranges inside it included: what a copy to a larger table moves. */
    get extent() {
      return end
    },
  }
}
