import type { PackedDag } from './types.ts'
import { packDoubles } from '../../../../math/src/float/splitDouble.ts'
import { writeRanges, type RangeTarget } from './split.ts'
import { resized } from '../../../../math/src/sequence/resized.ts'

/** Words of a primitive's exact translation, the `Origin` field of its worlds' record
 *  (`worldTable.ts`): three doubles, high word then low word, as the GPU holds a double
 *  (`math/src/wgsl/double.ts`), and two words of padding. Each cut reads its translations at its eye
 *  from them (`shader/worldPoseWgsl.ts`). */
const ORIGIN_WORDS = 8

/** Writes one placement's exact translation, three doubles, into `out` (words) from `at`. */
const writeOrigin = (out: Uint32Array, at: number, source: PackedDag['worldSources'][number]) =>
  packDoubles(out, at, source.world.elements, 12, 3)

/** The exact translations of `slots` placements — the live ones, and those a growth appends to
 *  `sources` —, each sent to `target`, the `Origin` field of the worlds' records, when it moved. */
export function createWorldOrigins(
  device: GPUDevice,
  slots: number,
  target: RangeTarget,
  sources: PackedDag['worldSources'],
) {
  const words = new Uint32Array(Math.max(slots, sources.length) * ORIGIN_WORDS),
    next = new Uint32Array(ORIGIN_WORDS),
    source = { data: words, sourceBase: 0, targetBase: 0, stride: ORIGIN_WORDS }
  let changed = new Int32Array(8)
  /** Placement `row`'s translation taken into `words`; whether it moved. */
  const take = (row: number) => {
    writeOrigin(next, 0, sources[row])
    const at = row * ORIGIN_WORDS
    let same = true
    for (let k = 0; k < ORIGIN_WORDS && same; k++) same = next[k] === words[at + k]
    if (same) return false
    words.set(next, at)
    return true
  }
  const origins = {
    hostBytes: words.byteLength + next.byteLength,
    /** Placement `row`'s translation as the GPU no longer holds it — its parent composed another
     *  there (`../../placement/gpuCompose.ts`) —: its next `write` sends it, whatever it was. */
    forget(row: number) {
      // No exact translation is a NaN: the cached words then match none.
      words.fill(0xffffffff, row * ORIGIN_WORDS, (row + 1) * ORIGIN_WORDS)
    },
    /** Called only for physical pose changes, never for a camera move: every placement's, or
     *  only those of `named`, increasing — the placements a call moved. Those it sent, increasing,
     *  a view the next call overwrites. */
    write(named?: Int32Array) {
      let count = 0
      const all = named === undefined,
        length = all ? sources.length : named.length
      for (let k = 0; k < length; k++) {
        const row = all ? k : named[k]
        if (!take(row)) continue
        if (count === changed.length) changed = resized(changed, count + 1)
        changed[count++] = row
      }
      if (count) writeRanges(device, target, changed, count, source)
      return changed.subarray(0, count)
    },
  }
  return origins
}
