import { TABLE_STRIDE } from './contract.ts'

/** A pattern's index in its table from its three factors, each in `1..TABLE_SIZE`, in any order:
 *  sorted into descending order, `x + y * 16 + z * 256` less the factors' own 1 each. */
export function patternIndex(a: number, b: number, c: number) {
  const [x, y, z] = [a, b, c].sort((p, q) => q - p)
  return x - 1 + (y - 1) * TABLE_STRIDE + (z - 1) * TABLE_STRIDE * TABLE_STRIDE
}
