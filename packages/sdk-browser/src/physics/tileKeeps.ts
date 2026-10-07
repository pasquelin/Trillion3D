import { partitionBy, selectByKey } from '../../../sdk-core/src/math/select.ts'
import type { SharedShapes } from './sharedShapes.ts'
import type { Placed, TileShape } from './tilePlace.ts'

const nearOf = (p: Placed) => p.near
const hasBody = (p: Placed) => p.id >= 0

/**
 * What the tiles hold from one update to the next: each tile a placement of which an update lets
 * in, kept restored by one use (`SharedShapes.use`) taken before the last update's are let go of,
 * with the placements let in that wait for its restore (`TileShape.waiting`); and the bodies of
 * the placements let in, the farthest leaving first for a body that needs a slot.
 */
export function createTileKeeps(shapes: SharedShapes, evict: (p: Placed) => void) {
  let keeping: TileShape[] = [],
    kept: TileShape[] = [],
    count = 0
  return {
    /** Keeps the tiles of `placed[0, n)`, let in by update `pass`, each unrestored one with the
     *  placements of it waiting; lets go of the last update's. */
    keep(placed: readonly Placed[], n: number, pass: number) {
      let next = 0
      for (let i = 0; i < n; i++) {
        const p = placed[i],
          shape = p.shape
        if (shape.kept !== pass) {
          shape.kept = pass
          shape.waits = 0
          shapes.use(shape)
          keeping[next++] = shape
        }
        if (shape.handle < 0) shape.waiting[shape.waits++] = p
      }
      for (let i = 0; i < count; i++) shapes.done(kept[i])
      const last = kept
      kept = keeping
      keeping = last
      count = next
    },
    /** Evicts the farthest body of `placed[0, n)`, the placements update `pass` let in, marked
     *  so that none is built for it again before the next update: O(n), nothing kept between. */
    evictFarthest(placed: Placed[], n: number, pass: number) {
      const bodied = partitionBy(placed, n, hasBody)
      if (!bodied) return
      selectByKey(placed, nearOf, 0, bodied, bodied - 1)
      const p = placed[bodied - 1]
      evict(p)
      p.left = pass
    },
  }
}
