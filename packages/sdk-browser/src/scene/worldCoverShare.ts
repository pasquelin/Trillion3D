/**
 * The held cells' share of the root cover: the roots one cell alone needs, which its bundles carry
 * (`top.rs`), join the cut's cache cover while held (`../webgpu/pages/prepare/worldRoot.ts`); the
 * cache that keeps them sets the room it leaves them (`room`), and a cell is held far only within it
 * (`admits`).
 */

/**
 * The share over the bundles `bundlesOf` lists per cell, `has` saying which a cell holds already:
 * `room` — none, any cell may be held — and whether a cell may be held far within it, the roots
 * `rootsIn` counts in the bundles it needs that no cell holds yet. A cell refused is asked again
 * only once that room grows: whatever else the cells hold meanwhile moves the room and its roots
 * alike.
 */
export function createCoverShare(
  bundlesOf: (cell: number) => Int32Array,
  has: (bundle: number) => boolean,
  rootsIn: (bundle: number) => number,
) {
  /** Per cell, the roots each of its bundles adds, counted once; per cell refused, the room. */
  const roots: Int32Array[] = [],
    refused = new Map<number, number>()
  const share = {
    room: undefined as (() => number) | undefined,
    admits(cell: number) {
      const room = share.room?.()
      if (room === undefined) return true
      if (room <= (refused.get(cell) ?? -1)) return false
      const bundles = bundlesOf(cell),
        adds = (roots[cell] ??= Int32Array.from(bundles, rootsIn))
      let added = 0
      for (let i = 0; i < bundles.length; i++) if (!has(bundles[i])) added += adds[i]
      if (added <= room) refused.delete(cell)
      else refused.set(cell, room)
      return added <= room
    },
  }
  return share
}
