import { sortPages } from '../../../../sdk-core/src/index.ts'
import { resized } from '../../../../math/src/sequence/resized.ts'
import type { FrameClock } from '../../page/integration/frameBudget.ts'

/**
 * Pages that claim the write of a row record and have not yet received it.
 *
 * Writing a row costs a material, a hash, wrap modes, a shadow sphere, eight corners and five row
 * words: a burst of arrivals pays that many times, on the main thread, in the same image. This list
 * is what remains to do, and the rank allocator spends only what the frame's one integration budget
 * has left — the rest waits for the next image, in the same order.
 *
 * A page enrols only once: per-page marking is what guarantees it, so a page claimed twice before it
 * is served does not double the work. The list is sorted before it is served, because the residency
 * journal writes ranges only while the indices it is given increase.
 */
export function createWebgpuRowClaims(pageCount: number) {
  let marks = new Uint8Array(Math.max(1, pageCount))
  let pages = new Int32Array(Math.max(1, pageCount))
  let count = 0
  return {
    get pages() {
      return pages
    },
    get count() {
      return count
    },
    /** Enrols a page, unless it is already waiting its turn. */
    add(page: number) {
      if (page >= marks.length) {
        marks = resized(marks, page + 1)
        pages = resized(pages, marks.length)
      }
      if (marks[page]) return
      marks[page] = 1
      pages[count++] = page
    },
    /** Sorts the list by increasing page index, the order the residency journal requires. */
    sort() {
      sortPages(pages, count)
    },
    /** Drops the first `served` pages, already served, and keeps the rest in its order. */
    consume(served: number) {
      for (let i = 0; i < served; i++) marks[pages[i]] = 0
      if (served < count) pages.copyWithin(0, served, count)
      count -= served
    },
    /** Nothing waits any more: the table has just been rebuilt as a block. */
    clear() {
      for (let i = 0; i < count; i++) marks[pages[i]] = 0
      count = 0
    },
  }
}

type WebgpuRowClaims = ReturnType<typeof createWebgpuRowClaims>

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

/**
 * Serves the queue in increasing page order within `budget` (`serveInOrder`), the rest waiting for
 * the next image in the same order. A page no rank is left for leaves the queue too, handed to
 * `refused`.
 */
export function serveClaims(
  claims: WebgpuRowClaims,
  release: (page: number) => boolean,
  place: (page: number) => boolean,
  budget?: FrameClock,
  refused?: (page: number) => void,
) {
  if (!claims.count) return
  claims.sort()
  const served = serveInOrder(claims.pages, 0, claims.count, release, place, budget, (page) => {
    refused?.(page)
    return false
  })
  claims.consume(served)
}
