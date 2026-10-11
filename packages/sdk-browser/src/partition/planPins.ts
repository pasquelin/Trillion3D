import { createListDifference } from '../webgpu/row/listDifference.ts'
import type { IndexPage } from './cellIndex.ts'

/** What pins and unpins a file: the streamer's counted pin (`PageStreamer.pin`). */
type Pins = { pin(url: string): void; unpin(url: string): void }

/** The files of one id space the plan pins: its difference from one frame to the next, and the
 *  address each pinned id was pinned under, which an id leaving the plan may no longer name. */
function createPinned() {
  let difference = createListDifference(),
    /** The streamer the pins are with: a session opened again on the kept cells has a new one, which
     *  holds none of them. */
    streamer: Pins['pin'] | undefined
  const urls = new Map<number, string>()
  return {
    /** The ids `ids` now pin: those that entered are pinned under `url(id)`, those that left
     *  unpinned. */
    apply(ids: ArrayLike<number>, url: (id: number) => string, { pin, unpin }: Pins) {
      if (streamer !== pin) {
        streamer = pin
        difference = createListDifference()
        urls.clear()
      }
      difference.apply(ids)
      for (let i = 0; i < difference.exitedCount; i++) {
        const id = difference.exited[i]
        unpin(urls.get(id)!)
        urls.delete(id)
      }
      for (let i = 0; i < difference.enteredCount; i++) {
        const id = difference.entered[i]
        urls.set(id, url(id))
        pin(urls.get(id)!)
      }
    },
  }
}

/**
 * THE FILES A PARTITION'S PLAN KEEPS IN THE STREAMER'S CACHE: the cells it places, those it reads
 * ahead, and the pages of the index it opens, each one pin from the frame that plans it until its
 * decode is taken (`decodes.ts`) or it leaves the plan. A file read ahead of need therefore
 * waits in the cache, whatever the cache holds, for the frame that places it. Only the difference
 * from the last frame is pinned or unpinned: O(changes).
 */
export function createPlanPins() {
  const cells = createPinned(),
    pages = createPinned()
  /** The ids a frame pins, and the address of each page among them: scratch kept between frames. */
  const ids: number[] = [],
    addresses = new Map<number, string>()
  return {
    /** Pins the cells of `lists` but those `took`, under `url`. */
    cells(
      lists: readonly (readonly number[])[],
      took: ReadonlySet<number>,
      url: (cell: number) => string,
      io: Pins,
    ) {
      ids.length = 0
      for (const list of lists) for (const cell of list) if (!took.has(cell)) ids.push(cell)
      cells.apply(ids, url, io)
    },
    /** Pins the pages of `lists` but those `took`. */
    pages(lists: readonly (readonly IndexPage[])[], took: ReadonlySet<number>, io: Pins) {
      ids.length = 0
      addresses.clear()
      for (const list of lists)
        for (const { id, slot } of list)
          if (!took.has(id)) {
            ids.push(id)
            addresses.set(id, slot.url)
          }
      pages.apply(ids, (id) => addresses.get(id)!, io)
    },
  }
}
