import { createSlotOrder } from '../../gpu/pool/slotOrder.ts'
import { ROW_IN_USE } from './rowEvictSortWgsl.ts'
import type { RowWords } from './rowWords.ts'

/** Frames the arrivals are remembered for: past the frames a readback lands behind its cut. */
const FRAMES = 8
/** Frames without a queue of the GPU after which a request no row serves is denied, the table
 *  growing by it: no cut ranked one — a still camera, a view drawn aside, a closure compiling. */
const STALE = 2 * ROW_IN_USE

const NONE = new Uint32Array(0)

/**
 * THE ROWS' VICTIM ORDER (#1527): the queues the GPU ranks over the live rows on the stamps the
 * cut's closure laid (`rowEviction.ts`), followed by the one taker of every GPU pool, keyed by page
 * (`../../gpu/pool/slotOrder.ts`): a page's row is read at the take, wherever a move put it, and a
 * page that took its row after the queue's cut is never its victim — its row's generation
 * (`rowWords.ts`) past the arrivals the rows had when that cut ran (`noteFrame`). A readback that
 * brings no queue to trust closes the order in hand. No clock and no sweep on the host.
 *
 * A request no free row serves waits for the next queue, which a cut asked again ranks (`ask`),
 * unless the GPU found nothing more to give — every other row in use — or no queue came for
 * `STALE` frames: then it is denied, and the table grows by it (`denies`).
 */
export function createRowOrder(
  rowOf: (page: number) => number,
  words: RowWords,
  /** Asks the next cut to cut again, and rank a queue on its way. */
  ask: () => void = () => {},
) {
  const order = createSlotOrder((page) => {
    const row = rowOf(page)
    return row < 0 ? undefined : words.generationOf(row)
  })
  const arrivals = new Float64Array(FRAMES).fill(-1),
    at = new Float64Array(FRAMES).fill(-1)
  let lastQueue = -Infinity,
    asked = -Infinity
  return {
    /** Frame `frame` cuts on the rows as they stand now: their arrivals noted. */
    noteFrame(frame: number) {
      arrivals[frame % FRAMES] = words.arrivals
      at[frame % FRAMES] = frame
    },
    /** A queue the GPU ranked at `frame` over `ranked` rows, its pages first victim first; none to
     *  trust (`undefined`): the order in hand closes. */
    follow(queue: Uint32Array | undefined, ranked: number, frame: number) {
      const slot = frame % FRAMES
      if (!queue || frame < 0 || at[slot] !== frame) return order.follow(NONE, 0, Infinity)
      order.follow(queue, arrivals[slot], ranked)
      lastQueue = Math.max(lastQueue, frame)
    },
    /** The page whose row a request takes, or `undefined`: none left in the order. */
    victim: () => order.victim(),
    /** Whether a request no free row serves at frame `now` is denied — the table grows by it —
     *  rather than waiting for the next queue, which is asked for then. */
    denies(now: number) {
      if (order.exhausted() || now - lastQueue > STALE) return true
      if (now - asked >= ROW_IN_USE) {
        asked = now
        ask()
      }
      return false
    },
    /** Every row given back at once, a new table: no order holds. */
    reset() {
      order.follow(NONE, 0, Infinity)
    },
  }
}

export type RowOrder = ReturnType<typeof createRowOrder>
