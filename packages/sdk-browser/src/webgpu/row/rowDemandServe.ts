import type { FrameClock } from '../../page/integration/frameBudget.ts'
import { serveInOrder } from './claims.ts'
import { LISTED, compact, isWanted, mark, type DemandState } from './rowDemandState.ts'

// The row demand's serve (`rowDemand.ts`): its list asked in order, each entry once, the passed
// ones unlisted, the refused one stopping it.

/** A refused request stops the serve: the table has no row for it, nor for any after it. */
export const STOP = () => true

/** Whether entry `page`, the next the serve asks, still claims a record (`release`); one it
 *  passes leaves the list, waiting for its bytes with its request kept when they are not there. */
export function claimsAt(d: DemandState, page: number) {
  const by = d.by[d.serving.at++]
  if (!isWanted(d, page)) {
    mark(d, page, LISTED, false)
    return false
  }
  if (d.serving.release(page)) return true
  mark(d, page, LISTED, false)
  if (!d.table.readsResident(page)) d.waitingBy.set(page, by + 1)
  return false
}

/** Entry `page` written at a row (`place`): it leaves the list. */
export function placedAt(d: DemandState, page: number) {
  if (!d.serving.place(page)) return false
  mark(d, page, LISTED, false)
  return true
}

export function serve(
  d: DemandState,
  release: (page: number) => boolean,
  place: (page: number) => boolean,
  budget: FrameClock | undefined,
) {
  d.fresh = d.owed = false
  // An entry the serve passes leaves the list: one the requests let go, served, or waiting for its
  // bytes — its request kept — is listed again as it comes back, lands or loses its row. The serve
  // asks each entry once, in order: `at` follows it.
  const s = d.serving
  s.release = release
  s.place = place
  s.at = d.next
  const stop = serveInOrder(d.list, d.next, d.count, s.claims, s.placed, budget, STOP)
  if (stop < 0) {
    d.next = ~stop
    return compact(d)
  }
  d.next = stop
  d.owed = d.next < d.count
  // Every request served or left for its bytes: the list starts again empty, the wanted kept.
  if (!d.owed) d.count = d.next = 0
  else if (d.next * 2 >= d.count) compact(d)
  return 0
}
