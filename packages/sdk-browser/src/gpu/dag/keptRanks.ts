import type { DagBufferRow } from './bufferTable.ts'
import { nextPow2 } from '../../../../math/src/scalar/integers.ts'

/**
 * EACH KEPT LIST'S TABLE OF RANKS: the rank each page of the kept snapshot holds, open-addressed by
 * page (`shader/differenceWgsl.ts`). Sized by the readout's list, never by the catalogue: twice its
 * cap in slots at least, a power of two, so a full list loads it to one half at most and a probe
 * stays short. Two words of generation, then three words a slot — the keep that wrote it, the
 * page, the rank —; made zero, a table holds nothing until its first keep.
 */
export const KEPT_RANK_HEAD = 2
const SLOT_WORDS = 3

/** Slots of a table for a list of `listCap` ranks: the shader's `keptSlots`. */
const keptRankSlots = (listCap: number) => nextPow2(2 * Math.max(1, listCap))

/** Kept list `l`'s table for a list of `listCap` ranks. */
export const keptRankRow = (l: number, listCap: number): DagBufferRow => ({
  label: `Trillion3D DAG kept ranks ${l}`,
  size: (KEPT_RANK_HEAD + SLOT_WORDS * keptRankSlots(listCap)) * 4,
})

/** The most ranks a list may hold whose table fits `bytes`: the largest power-of-two slots it
 *  holds, half of them — past 2³² ranks no list is named. */
export function keptRankCapHeld(bytes: number) {
  const fit = Math.min(2 ** 33, Math.floor((bytes / 4 - KEPT_RANK_HEAD) / SLOT_WORDS))
  if (fit < 2) return 0
  let slots = 2
  while (slots * 2 <= fit) slots *= 2
  return slots / 2
}
