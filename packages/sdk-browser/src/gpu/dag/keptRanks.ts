import type { DagBufferRow } from './bufferTable.ts'
import { halfLoadSlots, slotsWithin } from '../../../../math/src/scalar/integers.ts'
import { OPEN_SLOT_WORDS } from './heldOpen.ts'

/**
 * EACH KEPT LIST'S TABLE OF RANKS: the rank each page of the kept snapshot holds, open-addressed by
 * page (`shader/differenceWgsl.ts`). Sized by the readout's list, never by the catalogue: twice its
 * cap in slots at least, a power of two, so a full list loads it to one half at most and a probe
 * stays short. Two words of generation, then three words a slot — the keep that wrote it, the
 * page, the rank —; made zero, a table holds nothing until its first keep.
 */
export const KEPT_RANK_HEAD = 2

/** Kept list `l`'s table for a list of `listCap` ranks, its slots the shader's `keptSlots`. */
export const keptRankRow = (l: number, listCap: number): DagBufferRow => ({
  label: `Trillion3D DAG kept ranks ${l}`,
  size: (KEPT_RANK_HEAD + OPEN_SLOT_WORDS * halfLoadSlots(listCap)) * 4,
})

/** The most ranks a list may hold whose table fits `bytes`: the largest power-of-two slots it
 *  holds, half of them — past 2³² ranks no list is named. */
export function keptRankCapHeld(bytes: number) {
  const slots = Math.min(2 ** 33, slotsWithin(bytes - KEPT_RANK_HEAD * 4, OPEN_SLOT_WORDS * 4))
  return slots < 2 ? 0 : slots / 2
}
