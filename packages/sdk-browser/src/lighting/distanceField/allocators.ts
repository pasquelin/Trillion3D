/**
 * THE BLOCK ALLOCATOR OF THE MESH FIELDS' SPACE: it hands out blocks of the brick atlas, a block being a
 * fixed number of bricks (`meshDistanceFieldBlockBricks`): the blocks given back last are handed out
 * first, the atlas grows by the blocks it lacks. (The runs of words of the indirection tables are the
 * one span allocator's, `math/src/sequence/spanAllocator.ts`, grow-only.)
 */

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
