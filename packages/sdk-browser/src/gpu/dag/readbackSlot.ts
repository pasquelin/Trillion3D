import type { SelectionResult } from '../core/selection.ts'
import { parseDagOutput, type DagOutputScratch } from './uniforms.ts'
import { grownListCap, listDemand } from './listCap.ts'
import { coarsenAfter, type Coarsening } from './coarsening.ts'
import type { Limits } from './deviceListCap.ts'
import type { FlagShape } from './flagSections.ts'
import { grownFlagShape } from './queueGrowth.ts'

/** Where a readback's lists lie and what they are read into: the bytes copied, the drawn list's
 *  first word, the cap of the list they were cut on, the read's arrays, and the word of the
 *  admission counts (`levelCountsWord`). */
export type SlotRead = {
  bytes: number
  drawnWordOffset: number
  listCap: number
  scratch: DagOutputScratch
  levelsWord: number
}

/**
 * THE ONE READ OF A CUT'S READBACK, the main view's (`dispatch.ts`) and a view's drawn aside
 * (`aside.ts`), over the `range` its ring mapped (`../core/readbackRing.ts`): its lists parsed
 * into the read's arrays, the ranks the cut asked of its readout (`listDemand`), the cap a cut
 * past its list grows to (`grownListCap`, none once the device refused a larger one), the queues
 * and lists a cut that dropped work grows to (`grownFlagShape`, none once the device refused
 * larger ones), the view's factor followed (`coarsenAfter`) when the readout was cut under it
 * (`cutFactor`), and given back. `moved`: the factor moved, and the view cuts again; `retried`:
 * the cut dropped work, the list grows, or the cut overflowed under another factor than the
 * view's now, and the readout is not adopted. `land` reads the mapped words before they go.
 */
export function readDagSlot(
  range: ArrayBuffer,
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
}
