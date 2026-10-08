import type { PackedDag } from './types.ts'
import { packDoubles } from '../../placement/composedMotion.ts'
import { writeRanges, type RangeTarget } from './split.ts'
import { grown } from '../../page/cut/sparseInts.ts'

/** Two vec4s per primitive, behind its range's unchanged 64-byte camera matrices: its exact
 *  translation as three doubles, high word then low word, as the GPU holds a double (`DOUBLE_WGSL`),
 *  and two words of padding. Each cut reads its translations at its eye from them
 *  (`shader/worldPoseWgsl.ts`). */
export const WORLD_ORIGIN_BYTES = 32

/** Writes one placement's exact translation, three doubles, into `out` (words) from `at`. */
const writeOrigin = (
  out: Uint32Array,
  at: number,
  source: NonNullable<PackedDag['worldSources']>[number],
) => packDoubles(out, at, source.world.elements, 12, 3)

export function createWorldOrigins(
  device: GPUDevice,
  ranges: readonly { first: number; count: number }[],
  buffers: readonly GPUBuffer[],
  sources: PackedDag['worldSources'],
) {
  // Every placement the ranges hold: the live ones, and those a growth appends to `sources`.
  const slots = ranges.reduce((sum, { count }) => sum + count, 0),
    words = new Uint32Array(Math.max(slots, sources?.length ?? 0) * 8),
    next = new Uint32Array(8),
    source = { data: words, sourceBase: 0, targetBase: 0, stride: 8 }
  let changed = new Int32Array(8)
  /** Placement `row`'s translation taken into `words`; whether it moved. */
  const take = (row: number) => {
    writeOrigin(next, 0, sources![row])
    const at = row * 8
    let same = true
    for (let k = 0; k < 8 && same; k++) same = next[k] === words[at + k]
    if (same) return false
    words.set(next, at)
    return true
  }
  /** Bytes from `offset` of the translations, laid behind each range's worlds. */
  const target: RangeTarget = (offset, data, dataOffset, size) => {
    for (const [r, { first, count }] of ranges.entries()) {
      const a = Math.max(offset, first * WORLD_ORIGIN_BYTES),
        b = Math.min(offset + size, (first + count) * WORLD_ORIGIN_BYTES)
      if (a < b)
        device.queue.writeBuffer(
          buffers[r],
          count * 64 + a - first * WORLD_ORIGIN_BYTES,
          data,
          dataOffset + a - offset,
          b - a,
        )
    }
  }
  const origins = {
    hostBytes: words.byteLength + next.byteLength,
    /** Placement `row`'s translation as the GPU no longer holds it — its parent composed another
     *  there (`../../placement/gpuCompose.ts`) —: its next `write` sends it, whatever it was. */
    forget(row: number) {
      // No exact translation is a NaN: the cached words then match none.
      words.fill(0xffffffff, row * 8, row * 8 + 8)
    },
    /** Called only for physical pose changes, never for a camera rebase: every placement's, or
     *  only those of `named`, increasing — the placements a call moved. How many it sent. */
    write(named?: Int32Array) {
      if (!sources) return 0
      let count = 0
      const all = named === undefined,
        length = all ? sources.length : named.length
      for (let k = 0; k < length; k++) {
        const row = all ? k : named[k]
        if (row >= sources.length || !take(row)) continue
        if (count === changed.length) changed = grown(changed, count + 1, count)
        changed[count++] = row
      }
      if (count) writeRanges(device, target, changed, count, source)
      return count
    },
  }
  return origins
}
