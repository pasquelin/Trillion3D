import type { SelectionResult } from '../core/selection.ts'
import { parseDagOutput, type DagOutputScratch } from './uniforms.ts'
import { grownListCap, listDemand } from './listCap.ts'
import { coarsenAfter, type Coarsening } from './coarsening.ts'
import type { Limits } from './deviceListCap.ts'
import type { FlagShape } from './flagSections.ts'
import { grownFlagShape } from './queueGrowth.ts'

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
 * device refused a larger one), the queues and lists a cut that dropped work grows to
 * (`grownFlagShape`, none once the device refused larger ones), the view's factor followed
 * (`coarsenAfter`) when the readout was cut under it (`cutFactor`), and given back. `moved`: the
 * factor moved, and the view cuts again; `retried`: the cut dropped work, the list grows, or the
 * cut overflowed under another factor than the view's now, and the readout is not adopted. `land` reads the mapped words before they go. A
 * mapping the device refuses rejects with `SlotMapRefused`; the slot is unmapped whatever happens
 * after it.
 */
export async function readDagSlot(
  slot: GPUBuffer,
  read: SlotRead,
  growth: {
    limits: Limits
    pageCount: number
    /** The slots of open counts its readout holds behind its lists (`heldOpen.ts`). */
    heldSlots?: number
    listFull: boolean
    coarse: Coarsening
    cutFactor: number
    /** The cut's `flags` as it is, every entry its queues may hold, and whether the device refused
     *  a larger one (`queueGrowth.ts`). */
    flags: { shape: FlagShape; entryCount: number; full: boolean }
  },
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
        ? grownListCap(growth.limits, growth.pageCount, read.listCap, demand, growth.heldSlots)
        : undefined
    // A cut that dropped work grows what was full; its demand, short of the work dropped, tells the
    // factor nothing unless nothing can grow.
    const dropped = parsed?.dropped ?? 0,
      { coarse, cutFactor, flags } = growth
    const grownFlags =
      dropped && !flags.full
        ? grownFlagShape(
            growth.limits,
            { ...flags, pageCount: growth.pageCount },
            flags.shape,
            dropped,
          )
        : undefined
    const past = (!!parsed?.truncated && !grown) || (!!dropped && !grownFlags)
    const moved =
      !!parsed &&
      !grownFlags &&
      cutFactor === coarse.factor &&
      coarsenAfter(coarse, demand, read.listCap, past)
    const retried = !!grown || !!dropped || (past && coarse.factor !== cutFactor)
    land?.(range, parsed, retried)
    return { parsed, demand, grown, grownFlags, moved, retried }
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
