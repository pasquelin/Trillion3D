import type { SelectionSubmission } from '../core/selection.ts'

/** A shared encoder's settlement, heard once whatever is said after: `dropped` gives back what a
 *  command buffer never run claimed, `submitted` reads what it copied. */
export function settleOnce(dropped: () => void, submitted?: () => void): SelectionSubmission {
  let settled = false
  return (ran: boolean) => {
    if (settled) return
    settled = true
    if (ran) submitted?.()
    else dropped()
  }
}
