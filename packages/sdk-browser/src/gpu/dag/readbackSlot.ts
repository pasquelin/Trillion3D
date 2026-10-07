import type { SelectionResult } from '../core/selection.ts'
import { parseDagOutput, type DagOutputScratch } from './uniforms.ts'
import { grownListCap, listDemand } from './listCap.ts'
import type { Limits } from './deviceListCap.ts'

/** Where a slot's lists lie and what they are read into: the bytes copied, the drawn list's first
 *  word, the cap of the list they were cut on, the slot's arrays, and the word of the admission
 *  counts (`levelCountsWord`). */
export type SlotRead = {
  bytes: number
  drawnWordOffset: number
  listCap: number
  scratch: DagOutputScratch
  levelsWord: number
}

/** A slot's mapping the device refused, or `dispose` cut short: the one failure a read meets
 *  quietly — a device lost says so on its own (`device.lost`). Any other is the engine's. */
export class SlotMapRefused extends Error {}

/**
 * THE ONE READ OF A CUT'S READBACK SLOT, the main view's (`dispatch.ts`) and a view's drawn aside
 * (`aside.ts`): mapped, its lists parsed into the slot's arrays, the ranks the cut asked of its
 * readout (`listDemand`), the cap a cut past its list grows to (`grownListCap`, none once the
 * device refused a larger one), and given back. `land` reads the mapped words before they go. A
 * mapping the device refuses rejects with `SlotMapRefused`; the slot is unmapped whatever happens
 * after it.
 */
export async function readDagSlot(
  slot: GPUBuffer,
  read: SlotRead,
  growth: { limits: Limits; pageCount: number; listFull: boolean },
  land?: (words: ArrayBuffer, parsed: SelectionResult | null, grown: number | undefined) => void,
) {
  try {
    await slot.mapAsync(GPUMapMode.READ)
  } catch (cause) {
    throw new SlotMapRefused('DAG_SLOT_MAP_REFUSED', { cause })
  }
  try {
    const range = slot.getMappedRange()
    const demand = listDemand(range, read.drawnWordOffset)
    const parsed = parseDagOutput(
      range,
      0,
      read.bytes,
      read.drawnWordOffset,
      read.scratch,
      read.levelsWord,
    )
    const grown =
      parsed?.truncated && !growth.listFull
        ? grownListCap(growth.limits, growth.pageCount, read.listCap, demand)
        : undefined
    land?.(range, parsed, grown)
    return { parsed, demand, grown }
  } finally {
    try {
      slot.unmap()
    } catch {
      /* A slot `dispose` destroyed is unmapped already. */
    }
  }
}

/** The first slot of `mapped` free from `from` on, in turn; -1 when every one is still read. */
export function pickSlot(mapped: readonly boolean[], from: number) {
  for (let k = 0; k < mapped.length; k++) {
    const at = (from + k) % mapped.length
    if (!mapped[at]) return at
  }
  return -1
}
