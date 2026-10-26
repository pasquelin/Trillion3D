import { parseDagOutput, type DagOutputScratch } from './uniforms.ts'
import { listDemand } from './lists/listCap.ts'
import type { ListFeedback } from './lists/listFeedback.ts'
import type { CutListCaps } from './lists/cutListCaps.ts'

/** Where a readback's lists lie and what they are read into: the bytes copied, the drawn list's
 *  first word, the requests' priorities' first word, their page counts', and the read's arrays. */
export type SlotRead = {
  bytes: number
  drawnWordOffset: number
  priorityWordOffset: number
  countWordOffset: number
  scratch: DagOutputScratch
}

/**
 * THE ONE READ OF A CUT'S READBACK, the main view's (`dispatch.ts`) and a view's drawn aside
 * (`aside.ts`), over the `range` its ring mapped (`../../gpu/core/readbackRing.ts`): its lists parsed
 * into the read's arrays, the ranks the cut asked of its readout (`listDemand`) — a cut past the
 * readout's list is read by its head (`../cut/adoption/adoption.ts`) —, what it asked of its lists
 * noted against the caps they hold (`lists/listFeedback.ts`), and given back. A cut past a list's
 * cap drew what fit: its readback is the image's, adopted as any.
 */
export function readDagSlot(
  range: ArrayBuffer,
  read: SlotRead,
  lists: { feedback: ListFeedback; caps: CutListCaps },
) {
  const demand = listDemand(range, read.drawnWordOffset)
  const at = {
    drawn: read.drawnWordOffset,
    priorities: read.priorityWordOffset,
    counts: read.countWordOffset,
  }
  const parsed = parseDagOutput(range, 0, read.bytes, at, read.scratch)
  if (parsed?.peaks) lists.feedback(parsed.peaks, lists.caps)
  return { parsed, demand }
}
