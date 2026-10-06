import type { SharedShapes } from './sharedShapes.ts'
import type { Placed, TileShape } from './tilePlace.ts'

const farFirst = (a: { near: number }, b: { near: number }) => b.near - a.near

/**
 * What the tiles hold from one update to the next: each tile a placement of which an update lets
 * in, kept restored by one use (`SharedShapes.use`) taken before the last update's are let go of;
 * the bytes landed for the others, kept while the room left allows, the farthest let go first;
 * and the bodies of the placements let in, farthest first, for a body that needs a slot.
 */
export function createTileKeeps(shapes: SharedShapes, evict: (p: Placed) => void) {
  let keeping: TileShape[] = [],
    kept: TileShape[] = [],
    ordered = false,
    next = 0
  const landed: TileShape[] = [],
    order: Placed[] = []
  return {
    /** Keeps the tiles of `placed[0, n)`, let in by update `pass`; lets go of the last update's. */
    keep(placed: readonly Placed[], n: number, pass: number) {
      for (let i = 0; i < n; i++) {
        const shape = placed[i].shape
        if (shape.kept === pass) continue
        shape.kept = pass
        shapes.use(shape)
        keeping.push(shape)
      }
      for (let i = 0; i < kept.length; i++) shapes.done(kept[i])
      kept.length = 0
      const last = kept
      kept = keeping
      keeping = last
      ordered = false
    },
    /** Lets go of the bytes landed for tiles update `pass` keeps none of, farthest first — one
     *  it did not see at all first —, past `room`. */
    trim(room: number, pass: number) {
      landed.length = 0
      let total = 0
      for (const shape of shapes.landedShapes as TileShape[])
        if (shape.kind === 'tile' && shape.kept !== pass) {
          if (shape.seen !== pass) shape.near = Infinity
          landed.push(shape)
          total += shape.bytes
        }
      if (total <= room) return
      landed.sort(farFirst)
      for (let i = 0; i < landed.length && total > room; i++) {
        total -= landed[i].bytes
        shapes.drop(landed[i])
      }
    },
    /** Evicts the farthest body of `placed[0, n)`, the placements the last update let in: their
     *  order taken once an update, at its first eviction, each next one O(1) amortised. */
    evictFarthest(placed: readonly Placed[], n: number) {
      if (!ordered) {
        order.length = 0
        for (let i = 0; i < n; i++) order.push(placed[i])
        order.sort(farFirst)
        ordered = true
        next = 0
      }
      while (next < order.length) {
        const p = order[next++]
        if (p.id >= 0) return evict(p)
      }
    },
  }
}
