import { PAGE_INFO_STRIDE } from '../../visibility/buffer.ts'
import { ROW_MATERIAL_CLASS_WORD } from '../row/pageRow.ts'
import { rowsMoved, type RowsReading } from '../row/dirty.ts'

/** Which classes an image draws: a stamp per class key, the keys stamped by the last walk, and
 *  the rows that walk read. */
export type PresentClasses = {
  stamps: Uint32Array
  keys: number[]
  stamp: number
  read: RowsReading
}

/**
 * Classes of the packed rows: one word read per row, on the same table the GPU draws from, each
 * key listed once. A class the image has no row of is not drawn: its full-screen triangle would
 * be refused pixel by pixel, at the cost of a clear. The rows are walked again only when one was
 * written since (`writes`, `rowsMoved`); an image over the same rows reuses the keys.
 */
export function markPresentClasses(
  ints: Uint32Array,
  packedCount: number,
  into: PresentClasses,
  writes: number,
) {
  if (!rowsMoved(into.read, ints, packedCount, writes)) return into.keys
  const stride = PAGE_INFO_STRIDE / 4,
    stamp = ++into.stamp
  into.keys.length = 0
  for (let row = 0; row < packedCount; row++) {
    const key = ints[row * stride + ROW_MATERIAL_CLASS_WORD]
    if (into.stamps[key] === stamp) continue
    into.stamps[key] = stamp
    into.keys.push(key)
  }
  return into.keys
}
