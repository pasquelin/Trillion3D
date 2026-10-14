import { rowCell } from '../../partition/rowCells.ts'
import { clamp } from '../../../../math/src/scalar/reals.ts'
import type { DagRoot } from './types.ts'

/** THE PLACEMENT TREE'S ORDER (`placementTree.ts`): a partition's cells together, then the Morton
 *  curve of the other placements' translations. */

/** Bits a coordinate takes in a Morton code: three of them hold in a double's integer with the
 *  rank beside them, up to `2 ** (53 - 3 * MORTON_BITS)` placements. */
const MORTON_BITS = 10

/** The cell a partition placed placement `w`'s row in, or none. */
export type Ordered = Pick<DagRoot, 'world' | 'placement'>
const cellOf = (roots: readonly Ordered[], w: number) => {
  const placement = roots[w].placement
  return placement ? rowCell(placement.rows, placement.index)?.cell : undefined
}

/**
 * The tree's order of `members`: a partition's rows by their cell, the cell's together, then every
 * other placement on the Morton curve of its translation over the box that holds them — a cell's
 * rows lie together however its rows were filled, the others side by side as they stand.
 */
export function placementOrder(roots: readonly Ordered[], members: number[]) {
  const rankBits = 53 - 3 * MORTON_BITS
  if (roots.length > 2 ** rankBits) return Uint32Array.from(members)
  const celled: number[] = [],
    free: number[] = []
  for (const w of members) (cellOf(roots, w) === undefined ? free : celled).push(w)
  celled.sort((a, b) => cellOf(roots, a)! - cellOf(roots, b)! || a - b)
  const order = new Uint32Array(members.length)
  order.set(celled)
  order.set(mortonOrder(roots, free, rankBits), celled.length)
  return order
}

/** `members` sorted on the Morton curve of their translations over the box that holds them. */
function mortonOrder(roots: readonly Ordered[], members: number[], rankBits: number) {
  const low = [Infinity, Infinity, Infinity],
    high = [-Infinity, -Infinity, -Infinity]
  for (const w of members)
    for (let a = 0; a < 3; a++) {
      const t = roots[w].world.elements[12 + a]
      low[a] = Math.min(low[a], t)
      high[a] = Math.max(high[a], t)
    }
  const cells = 2 ** MORTON_BITS - 1,
    keys = new Float64Array(members.length)
  members.forEach((w, k) => {
    let code = 0
    for (let a = 0; a < 3; a++) {
      const span = high[a] - low[a],
        q = span > 0 ? Math.floor(((roots[w].world.elements[12 + a] - low[a]) / span) * cells) : 0
      code += spread(clamp(q || 0, 0, cells)) * 2 ** a
    }
    keys[k] = code * 2 ** rankBits + w
  })
  keys.sort()
  return Array.from(keys, (key) => key % 2 ** rankBits)
}

/** `q`'s bits spread three apart, the first at bit 0: one axis of a Morton code. */
function spread(q: number) {
  let code = 0
  for (let bit = 0; bit < MORTON_BITS; bit++) if (q & (1 << bit)) code += 2 ** (3 * bit)
  return code
}
