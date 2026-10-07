import type { CutDifference } from '../../gpu/core/selection.ts'
import { grown } from '../../page/cut/sparseInts.ts'
import type { HeldList } from './heldList.ts'

/** Each held id's rank plus one, taken again from the held list: after a list applied whole. */
function keepSlots(held: HeldList) {
  held.slotOf.clear()
  for (let rank = 0; rank < held.count; rank++) held.slotOf.set(held.ids[rank], rank + 1)
  held.slotsStale = false
}

/**
 * The held list follows the changes the GPU took (`../../gpu/dag/differenceChain.ts`): each exit's
 * rank taken by the list's last, each entry behind the last — with its record, when the list keeps
 * them —, so nothing but the changes is read or written: O(entered + exited), zero when the cut
 * holds. An exit the list does not hold, an entry it holds already or one without a record changes
 * nothing. The list is the cut as a set, in no order the GPU gave.
 */
export function applyNet(
  held: HeldList & { changed: boolean; publishedCount: number },
  difference: CutDifference,
) {
  if (held.slotsStale) keepSlots(held)
  const { mark, slotOf, pages, recordOf, epoch } = held,
    { enteredCount, exitedCount } = difference
  if (held.exited.length < exitedCount) held.exited = grown(held.exited, exitedCount)
  if (held.entered.length < enteredCount) held.entered = grown(held.entered, enteredCount)
  if (held.ids.length < held.count + enteredCount)
    held.ids = grown(held.ids, held.count + enteredCount, held.count)
  let exited = 0,
    entered = 0
  for (let k = 0; k < exitedCount; k++) {
    const id = difference.exited[k],
      slot = slotOf.get(id) - 1
    if (slot < 0) continue
    const last = --held.count,
      moved = held.ids[last]
    held.ids[slot] = moved
    if (pages) pages[slot] = pages[last]
    slotOf.set(moved, slot + 1)
    slotOf.set(id, 0)
    mark.set(id, 0)
    held.exited[exited++] = id
  }
  for (let k = 0; k < enteredCount; k++) {
    const id = difference.entered[k],
      rec = recordOf(id)
    if (!rec || mark.get(id) === epoch) continue
    const slot = held.count++
    held.ids[slot] = id
    if (pages) pages[slot] = rec
    slotOf.set(id, slot + 1)
    mark.set(id, epoch)
    held.entered[entered++] = id
  }
  if (pages) pages.length = held.count
  held.enteredCount = entered
  held.exitedCount = exited
  held.changed = entered + exited > 0
  // The next list read whole is compared to nothing: the held one is no sequence the GPU published.
  held.publishedCount = -1
  held.rawToHeld = false
}
