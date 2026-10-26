import { floorLog2 } from '../scalar/integers.ts'

/**
 * The place the `index`-th image takes in a square of `side` × `side` positions, `side` a power of
 * two, packed as `column | row << log2(side)`: the index in the square's count, its bits reversed —
 * so that any run of consecutive indices lies spread over the whole square, not along one of its
 * rows — and unfolded along a Morton curve, the even bits of the reversed word the column, the odd
 * ones the row. A square of one position has the one place, 0.
 */
export function reversedMortonOffset(index: number, side: number) {
  const axisBits = floorLog2(side),
    bits = 2 * axisBits,
    wrapped = index % (side * side)
  let reversed = 0
  for (let bit = 0; bit < bits; bit++) reversed |= ((wrapped >> bit) & 1) << (bits - 1 - bit)
  let column = 0,
    row = 0
  for (let bit = 0; bit < axisBits; bit++) {
    column |= ((reversed >> (2 * bit)) & 1) << bit
    row |= ((reversed >> (2 * bit + 1)) & 1) << bit
  }
  return column | (row << axisBits)
}
