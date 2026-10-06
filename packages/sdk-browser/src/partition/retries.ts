/**
 * WHEN A CELL WHOSE HOLD FAILED IS HELD AGAIN (`cellPages.ts`): after 0.5 s · 2^(k−1) for its k-th
 * failure in a row, capped at 8 s. A failure is never asked again in its own frame, and a source
 * refusing every read of F cells is asked at most F times in the first half second, then ever more
 * seldom, down to F every 8 s — never once a frame.
 *
 * Each delay is a lane, and a lane is due in the order its cells failed: a frame reads the due cells
 * at the lanes' heads, O(1) a failure and O(1) a cell due, nothing for the cells still waiting. A
 * cell that leaves is crossed out where it waits, skipped once its lane reaches it.
 */
const FIRST_RETRY_MS = 500,
  LAST_RETRY_MS = 8000
/** One lane per delay, 0.5 s to 8 s doubling: five. */
const LANES = Math.log2(LAST_RETRY_MS / FIRST_RETRY_MS) + 1

function createRetries<T>() {
  type Wait = { item: T; at: number }
  const lanes = Array.from({ length: LANES }, () => ({ waits: [] as Wait[], head: 0 }))
  /** Each item's wait: a lane's entry is its item's while it is this one. */
  const waiting = new Map<T, Wait>()
  /** `lane`'s first wait still current, its head past those crossed out, or `undefined`. */
  const headOf = (lane: (typeof lanes)[number]) => {
    const { waits } = lane
    while (lane.head < waits.length && waiting.get(waits[lane.head].item) !== waits[lane.head])
      lane.head++
    if (lane.head * 2 > waits.length) {
      waits.splice(0, lane.head)
      lane.head = 0
    }
    return waits[lane.head] as Wait | undefined
  }
  return {
    /** `item` failed for the `tries`-th time in a row: it is due once its delay is over. True when
     *  that delay is the longest. */
    wait(item: T, tries: number) {
      const lane = Math.min(tries, LANES) - 1,
        own = { item, at: performance.now() + FIRST_RETRY_MS * 2 ** lane }
      waiting.set(item, own)
      lanes[lane].waits.push(own)
      return lane === LANES - 1
    },
    /** `item` waits no more. */
    cancel: (item: T) => void waiting.delete(item),
    /** The items due now, each once and no longer waiting. */
    due() {
      const now = performance.now(),
        due: T[] = []
      for (const lane of lanes)
        for (let own = headOf(lane); own && own.at <= now; own = headOf(lane)) {
          waiting.delete(own.item)
          due.push(own.item)
        }
      return due
    },
    /** Milliseconds until the next item is due, `undefined` while none waits. */
    next() {
      let at = Infinity
      for (const lane of lanes) at = Math.min(at, headOf(lane)?.at ?? Infinity)
      return at === Infinity ? undefined : Math.max(0, at - performance.now())
    },
  }
}

/** Hears a cell whose hold keeps failing, once it waits the longest. */
export type HoldFailure = (failure: { cell: number; cause: unknown }) => void

/** The placed cells whose hold failed, each waiting its turn with the priority it was held at,
 *  and its failures in a row; one that reaches the longest wait is told `said`, once. */
export function createHoldRetries(said?: HoldFailure) {
  const retries = createRetries<number>(),
    failures = new Map<number, { tries: number; said: boolean; priority: number }>()
  return {
    /** `cell`'s hold at `priority` failed by `cause`: it waits its turn. */
    failed(cell: number, priority: number, cause: unknown) {
      const failure = failures.get(cell) ?? { tries: 0, said: false, priority }
      failures.set(cell, failure)
      failure.priority = priority
      if (!retries.wait(cell, ++failure.tries) || failure.said) return
      failure.said = true
      said?.({ cell, cause })
    },
    /** `cell`'s hold landed, or it left: its failures in a row are over, its turn let go. */
    over(cell: number) {
      failures.delete(cell)
      retries.cancel(cell)
    },
    /** The cells due now, each with the priority it is held again at. */
    due: () => retries.due().map((cell) => [cell, failures.get(cell)!.priority] as const),
    /** Settles once the next cell is due; `undefined` while none waits. */
    turn() {
      const wait = retries.next()
      return wait === undefined ? undefined : new Promise<void>((done) => setTimeout(done, wait))
    },
  }
}
