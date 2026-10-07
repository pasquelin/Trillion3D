import type { PackedDag } from './types.ts'

/** Two vec4s per primitive, behind its range's unchanged 64-byte camera matrices: its exact
 *  translation as three doubles, high word then low word, as the GPU holds a double (`DOUBLE_WGSL`),
 *  and two words of padding. The cut's worlds are brought to the eye from them (`worldRebase.ts`). */
export const WORLD_ORIGIN_BYTES = 32

const bits = new Float64Array(1),
  bitWords = new Uint32Array(bits.buffer)

/** Writes one placement's exact translation, three doubles, into `out` (words) from `at`. */
function writeOrigin(
  out: Uint32Array,
  at: number,
  source: NonNullable<PackedDag['worldSources']>[number],
) {
  const e = source.world.elements
  for (let axis = 0; axis < 3; axis++) {
    bits[0] = e[12 + axis]
    out[at + 2 * axis] = bitWords[1]
    out[at + 2 * axis + 1] = bitWords[0]
  }
}

export function createWorldOrigins(
  device: GPUDevice,
  ranges: readonly { first: number; count: number }[],
  buffers: readonly GPUBuffer[],
  sources: PackedDag['worldSources'],
) {
  // Every placement the ranges hold: the live ones, and those a growth appends to `sources`.
  const slots = ranges.reduce((sum, { count }) => sum + count, 0),
    words = new Uint32Array(Math.max(slots, sources?.length ?? 0) * 8),
    next = new Uint32Array(8)
  return {
    hostBytes: words.byteLength + next.byteLength,
    /** Called only for physical pose changes, never for a camera rebase. */
    write() {
      if (!sources) return false
      let from = Infinity,
        to = -1
      for (let row = 0; row < sources.length; row++) {
        const at = row * 8
        writeOrigin(next, 0, sources[row])
        if (next.every((value, k) => value === words[at + k])) continue
        words.set(next, at)
        from = Math.min(from, row)
        to = row
      }
      if (to < from) return false
      for (const [r, { first, count }] of ranges.entries()) {
        const a = Math.max(from, first),
          b = Math.min(to + 1, first + count)
        if (a < b)
          device.queue.writeBuffer(
            buffers[r],
            count * 64 + (a - first) * WORLD_ORIGIN_BYTES,
            words.buffer,
            a * WORLD_ORIGIN_BYTES,
            (b - a) * WORLD_ORIGIN_BYTES,
          )
      }
      return true
    },
  }
}
