import { RUN_WORDS } from './planLayout.ts'
import { INSTANCE_CULL_SHIFT } from './runs.ts'

/** The first word of an expanded instance (`INSTANCE_CULL_SHIFT`): the CPU model's. */
export const instanceWord = (item: number, vertexCull: number) =>
  (item | (vertexCull << INSTANCE_CULL_SHIFT)) >>> 0

/** Writes the run of slot `slot`. */
const runAt = (out: Uint32Array, slot: number, first: number, entries: number) => {
  out[slot * RUN_WORDS] = first
  out[slot * RUN_WORDS + 1] = entries
}

/**
 * The run of each slot, from where the paint order put each seed (`placed`) and the own entries'
 * seeds and slots in paint order: the CPU model of `placeBlendSlots`, word for word. Each own entry
 * writes its own slot and the gap before it, the last one the gap after it too.
 */
export function placeBlendSlots(
  out: Uint32Array,
  placed: Uint32Array,
  own: { seeds: Uint32Array; slots: Uint32Array },
  entries: number,
  main: boolean,
) {
  const count = own.seeds.length
  if (!count && main) runAt(out, 0, 0, entries)
  for (let k = 0; k < count; k++) {
    const slot = own.slots[k],
      at = placed[own.seeds[k]]
    runAt(out, slot, at, 1)
    if (!main) continue
    if (!k || slot - own.slots[k - 1] > 1) {
      const first = k ? placed[own.seeds[k - 1]] + 1 : 0
      runAt(out, slot - 1, first, Math.max(0, at - first))
    }
    if (k === count - 1) runAt(out, slot + 1, at + 1, entries - at - 1)
  }
}
