/**
 * THE TWO ALLOCATORS OF THE MESH FIELDS' SPACE.
 *
 * The span allocator hands out runs of the indirection tables' words: the first free run that is
 * long enough, the end of the buffer where none is, and a run given back is joined to the free runs
 * on either side of it. The buffer only grows.
 *
 * The block allocator hands out blocks of the brick atlas, a block being a fixed number of bricks
 * (`meshDistanceFieldBlockBricks`): the blocks given back last are handed out first, the atlas
 * grows by the blocks it lacks.
 */

type Span = { start: number; length: number }

/** A grow-only allocator of runs of words. */
export function createSpanAllocator() {
  let size = 0
  const free: Span[] = []
  return {
    /** The first word of a run of `length` words. */
    allocate(length: number) {
      const found = free.findIndex((span) => span.length >= length)
      if (found >= 0) {
        const span = free[found]
        if (span.length > length)
          free[found] = { start: span.start + length, length: span.length - length }
        else {
          free[found] = free[free.length - 1]
          free.pop()
        }
        return span.start
      }
      const start = size
      size += length
      return start
    },
    /** Gives back the run of `length` words at `start`, joined to the free runs next to it. */
    release(start: number, length: number) {
      let before = -1,
        after = -1
      free.forEach((span, at) => {
        if (span.start === start + length) after = at
        if (span.start + span.length === start) before = at
      })
      if (before >= 0) {
        free[before].length += length
        if (after >= 0) {
          free[before].length += free[after].length
          free[after] = free[free.length - 1]
          free.pop()
        }
      } else if (after >= 0) {
        free[after].start = start
        free[after].length += length
      } else free.push({ start, length })
    },
    /** The words the buffer must hold. */
    get size() {
      return size
    },
  }
}

/** An allocator of blocks of the brick atlas. */
export function createBlockAllocator() {
  let blocks = 0
  const free: number[] = []
  return {
    /** `count` blocks: the last freed first, then the new ones past the end. */
    allocate(count: number) {
      const out: number[] = []
      const reused = Math.min(count, free.length)
      for (let k = 0; k < reused; k++) out.push(free[free.length - 1 - k])
      free.length -= reused
      for (let k = reused; k < count; k++) out.push(blocks++)
      return out
    },
    /** Gives the blocks back. */
    release(given: readonly number[]) {
      free.push(...given)
    },
    /** The blocks the atlas has had to hold at once. */
    get size() {
      return blocks
    },
    /** The blocks in use. */
    get used() {
      return blocks - free.length
    },
  }
}

export type SpanAllocator = ReturnType<typeof createSpanAllocator>
export type BlockAllocator = ReturnType<typeof createBlockAllocator>
