import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import type { BounceCascades } from './cascades.ts'
import type { ProbePool } from './probePool.ts'

/** Words of the marks' bitmap: a bit a cell of every level. */
export const markWords = (cascades: BounceCascades) =>
  ceilDiv(cascades.levels.length * cascades.cells, 32)

/**
 * The cells the GPU marked in an image, a bit each, in the order level, z, y, x of the remainders
 * of the cell modulo the side (`ProbeSlots.entryAt`): each set bit is a cell of the window the
 * image was made in — `bases`, three a level, the lowest cell of each — handed to the pool as
 * read at `frame`. A cell the levels have slid out of since is the pool's to refuse
 * (`ProbePool.mark`). Returns how many cells were marked.
 */
export function applyMarks(
  bits: Uint32Array,
  bases: ArrayLike<number>,
  cascades: BounceCascades,
  pool: ProbePool,
  frame: number,
) {
  const { size, cells } = cascades
  const toCell = (remainder: number, base: number) =>
    base + ((((remainder - base) % size) + size) % size)
  let marked = 0
  for (let word = 0; word < bits.length; word++) {
    for (let bit = bits[word]; bit; bit &= bit - 1) {
      const index = word * 32 + (31 - Math.clz32(bit & -bit))
      const level = Math.floor(index / cells)
      const rest = index - level * cells
      const x = rest % size,
        y = Math.floor(rest / size) % size,
        z = Math.floor(rest / (size * size))
      const at = level * 3
      pool.mark(
        level,
        toCell(x, bases[at]),
        toCell(y, bases[at + 1]),
        toCell(z, bases[at + 2]),
        frame,
      )
      marked++
    }
  }
  return marked
}
