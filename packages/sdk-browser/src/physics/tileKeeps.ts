import type { SharedShapes } from './sharedShapes.ts'
import type { Placed, TileShape } from './tilePlace.ts'

const farFirst = (a: { near: number }, b: { near: number }) => b.near - a.near

/**
 * What the tiles hold from one update to the next: each tile a placement of which an update lets
 * in, kept restored by one use (`SharedShapes.use`) taken before the last update's are let go of,
 * with the placements let in that wait for its restore (`TileShape.waiting`); the placements let
 * in that wait for a body on a restored tile (`ready`); and the bodies of the placements let in,
 * the farthest leaving first for a body that needs a slot. Every list is written over with its
 * count; `trim` cuts their tails once a model leaves.
 */
export function createTileKeeps(shapes: SharedShapes, evict: (p: Placed) => void) {
  let keeping: TileShape[] = [],
    kept: TileShape[] = [],
    count = 0,
    orders = 0,
    next = 0,
    ordered = false
  /** The bodies let in, farthest first, `orders` of them, taken from `next` on. */
  const order: Placed[] = []
  /** The placements let in waiting for a body on a restored tile. */
  const ready: Placed[] = []
  return {
    ready,
    /** Keeps the tiles of `placed[0, n)`, let in by update `pass`, each unrestored one with the
     *  placements of it waiting; lets go of the last update's: the placements `ready`, counted. */
    keep(placed: readonly Placed[], n: number, pass: number) {
      let tiles = 0,
        waiting = 0
      for (let i = 0; i < n; i++) {
        const p = placed[i],
          shape = p.shape
        if (shape.kept !== pass) {
          shape.kept = pass
          shape.waits = 0
          shapes.use(shape)
          keeping[tiles++] = shape
        }
        if (shape.handle < 0) shape.waiting[shape.waits++] = p
        else if (p.id < 0) ready[waiting++] = p
      }
      for (let i = 0; i < count; i++) shapes.done(kept[i])
      const last = kept
      kept = keeping
      keeping = last
      count = tiles
      ordered = false
      return waiting
    },
    /** Bodies built since the order was taken: the next eviction takes it again. */
    unorder: () => void (ordered = false),
    /** Evicts the farthest body of `placed[0, n)`, the placements the last update let in: their
     *  bodies ordered once, at the first eviction, each next one O(1). */
    evictFarthest(placed: readonly Placed[], n: number) {
      if (!ordered) {
        orders = next = 0
        for (let i = 0; i < n; i++) if (placed[i].id >= 0) order[orders++] = placed[i]
        order.length = orders
        order.sort(farFirst)
        ordered = true
      }
      while (next < orders) {
        const p = order[next++]
        if (p.id >= 0) return evict(p)
      }
    },
    /**
     * Lets the farthest restored tiles of `tiles` — nearest first — update `pass` kept go until
     * `needed` bytes more are free, every body of them among `placed[0, n)`, the placements it let
     * in: their uses given back and the shapes released (`settle`). O(U + n), a rare path.
     */
    letGoFarthest(
      tiles: TileShape[],
      placed: readonly Placed[],
      n: number,
      pass: number,
      needed: number,
    ) {
      for (let i = tiles.length - 1; i >= 0 && needed > 0; i--) {
        const shape = tiles[i]
        if (shape.kept !== pass || shape.handle < 0) continue
        shape.kept = -1
        needed -= shape.bytes
        for (let k = 0; k < count; k++)
          if (kept[k] === shape) {
            kept[k] = kept[--count]
            shapes.done(shape)
            break
          }
      }
      for (let i = 0; i < n; i++) if (placed[i].shape.kept !== pass) evict(placed[i])
      shapes.settle()
    },
    /** The tiles and placements its lists name, tails included. */
    listed: () => kept.length + keeping.length + ready.length + order.length,
    /** Cuts every list to what is held: the tiles no one holds let go of. */
    trim() {
      let tiles = 0
      for (let i = 0; i < count; i++)
        if (kept[i].holders) kept[tiles++] = kept[i]
        else shapes.done(kept[i])
      kept.length = count = tiles
      keeping.length = ready.length = order.length = orders = next = 0
      ordered = false
    },
  }
}
