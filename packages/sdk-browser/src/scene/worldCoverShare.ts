/**
 * The held cells' share of the root cover: the roots one cell alone needs, which its bundles carry
 * (`top.rs`), join the cut's cache cover while held (`../webgpu/pages/prepare/worldRoot.ts`); the
 * cache that keeps them gives the room it leaves them for its session's life (`bind`), and a cell
 * is held far only within it (`admits`).
 */

/**
 * The share over the bundles `bundlesOf` lists per cell, `has` saying which a cell holds already:
 * the room the live sessions leave (`room`) — none, any cell may be held — and whether a cell may
 * be held far within it, the roots `rootsIn` counts in the bundles it needs that no cell holds
 * yet. A cell refused is asked again only once that room grows: whatever else the cells hold
 * meanwhile moves the room and its roots alike.
 */
export function createCoverShare(
  bundlesOf: (cell: number) => ArrayLike<number>,
  has: (bundle: number) => boolean,
  rootsIn: (bundle: number) => number,
  /** Told of each cell the share forgets: what else is kept of it may go too. */
  forgotten: (cell: number) => void = () => {},
) {
  /** Per cell asked, the roots each of its bundles adds, counted once; per cell refused, the room.
   *  A cell let go — released, or past the plan's reach — is forgotten (`forget`, `keep`). */
  const roots = new Map<number, Int32Array>(),
    refused = new Map<number, number>()
  /** The rooms the live sessions gave: one whose session ended stands no more. */
  const rooms: { room: () => number; session: AbortSignal }[] = []
  const share = {
    /** `room` is what a session's cache leaves the held cells, while `session` lives. */
    bind(room: () => number, session: AbortSignal) {
      if (!session.aborted) rooms.push({ room, session })
    },
    /** The room every live session leaves — the least of theirs: the held cells are shared by
     *  every engine drawing them, each cache holds them all —, or none. */
    room() {
      let least: number | undefined
      for (let k = rooms.length - 1; k >= 0; k--)
        if (rooms[k].session.aborted) rooms.splice(k, 1)
        else least = Math.min(least ?? Infinity, rooms[k].room())
      return least
    },
    admits(cell: number) {
      const room = share.room()
      if (room === undefined) return true
      if (room <= (refused.get(cell) ?? -1)) return false
      const bundles = bundlesOf(cell)
      let adds = roots.get(cell)
      if (!adds) roots.set(cell, (adds = Int32Array.from(bundles, rootsIn)))
      let added = 0
      for (let i = 0; i < bundles.length; i++) if (!has(bundles[i])) added += adds[i]
      if (added <= room) refused.delete(cell)
      else refused.set(cell, room)
      return added <= room
    },
    /** `cell` let go: what was counted of it is too. */
    forget(cell: number) {
      roots.delete(cell)
      refused.delete(cell)
      forgotten(cell)
    },
    /** The cells the plan reaches now: every other is forgotten — a cell refused was counted
     *  first. */
    keep(cells: { has(cell: number): boolean }) {
      for (const cell of roots.keys()) if (!cells.has(cell)) share.forget(cell)
    },
  }
  return share
}
