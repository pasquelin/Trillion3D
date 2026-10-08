import type { SelectionResult } from '../core/selection.ts'
import { parseDagOutput, type DagOutputScratch } from './uniforms.ts'
import { coarsened, grownListCap, listDemand } from './listCap.ts'
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
 * device refused a larger one), the factor its threshold is cut under next, from the one it was cut
 * under (`coarsened`), and given back. `retried`: the list grows or the cut coarsens, and the view
 * cuts again rather than adopt this readout. `land` reads the mapped words before they go. A
 * mapping the device refuses rejects with `SlotMapRefused`; the slot is unmapped whatever happens
 * after it.
 */
export async function readDagSlot(
  slot: GPUBuffer,
  read: SlotRead,
  growth: { limits: Limits; pageCount: number; listFull: boolean; coarsen: number },
  land?: (words: ArrayBuffer, parsed: SelectionResult | null, retried: boolean) => void,
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
    const past = !!parsed?.truncated && !grown,
      coarsen = parsed ? coarsened(growth.coarsen, demand, read.listCap, past) : growth.coarsen
    const retried = !!grown || coarsen > growth.coarsen
    land?.(range, parsed, retried)
    return { parsed, demand, grown, coarsen, retried }
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
