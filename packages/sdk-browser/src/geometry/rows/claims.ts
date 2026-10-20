import { sortPages } from '../../../../sdk-core/src/page/integrationPlan.ts'
import type { createMarkedList } from '../../../../math/src/sequence/markedList.ts'
import type { FrameClock } from '../integration/frameBudget.ts'

/**
 * THE ONE SERVE LOOP of the row writers: `pages[from, to)` in their order within `budget`, the
 * frame's one integration budget (`EngineContext.frameBudget`): what its cells and arrivals left,
 * its clock running only while rows are written and reread after each. At least one row always
 * goes through, or a page would never be written. `release` says again whether the page still
 * claims a row — it may have left since it was listed, and then costs nothing —, `place` writes it
 * and returns `false` when no rank is left for it: `refused` then says whether that stops the
 * serve there. No `budget` — a barrier image, outside the measured loop, or an engine driven with
 * no frame — serves every page. Returns the rank the next serve starts at, or its complement
 * (`~rank`, negative) when a refusal stopped it at that rank.
 */
export function serveInOrder(
  pages: ArrayLike<number>,
  from: number,
  to: number,
  release: (page: number) => boolean,
  place: (page: number) => boolean,
  budget?: FrameClock,
  refused?: (page: number) => boolean,
) {
  if (from >= to) return from
  budget?.resume()
  let at = from
  try {
    while (at < to) {
      const page = pages[at]
      if (!release(page)) {
        at++
        continue
      }
      if (!place(page)) {
        if (refused?.(page)) return ~at
        at++
        continue
      }
      at++
      budget?.spend()
      if (budget && !budget.admits()) break
    }
  } finally {
    // Balanced on every path: what runs after the rows is not integration.
    budget?.pause()
  }
  return at
}

/** `pages[0, count)` with the pages `leads` names moved ahead of the others, each side keeping its
 *  order. */
export function leadFirst(pages: Int32Array, count: number, leads: (page: number) => boolean) {
  const behind: number[] = []
  let at = 0
  for (let i = 0; i < count; i++) {
    const page = pages[i]
    if (leads(page)) pages[at++] = page
    else behind.push(page)
  }
  pages.set(behind, at)
}

/**
 * Serves the claims — pages that claim the write of a row record, each listed once
 * (`createMarkedList`) — in increasing page order within `budget` (`serveInOrder`), those `leads`
 * names first, the rest waiting for the next image in the same order. A page no rank is left for
 * leaves the queue too, handed to `refused`.
 */
export function serveClaims(
  claims: ReturnType<typeof createMarkedList>,
  release: (page: number) => boolean,
  place: (page: number) => boolean,
  budget?: FrameClock,
  refused?: (page: number) => void,
  leads?: (page: number) => boolean,
) {
  if (!claims.count) return
  sortPages(claims.list, claims.count)
  if (leads) leadFirst(claims.list, claims.count, leads)
  const served = serveInOrder(claims.list, 0, claims.count, release, place, budget, (page) => {
    refused?.(page)
    return false
  })
  claims.consume(served)
}
