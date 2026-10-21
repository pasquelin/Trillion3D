/**
 * THE SLOTS WAITING TO BE SWITCHED AGAIN, of the HLOD cells (`worldFollow.ts`) and of the cell files
 * (`worldFiles.ts`): each slot marked is listed once, and taken last in, first out — the order the
 * switches settle in, one that marks another while they are taken settling it before the rest.
 */

/** The marks over `slots` slots. */
export function createMarkStack(slots: number) {
  /** Per slot, whether it is listed; the slots listed, in the order marked. */
  const queued = new Uint8Array(slots),
    pending: number[] = []
  return {
    /** Slot `at` waits to be switched again. */
    mark(at: number) {
      if (queued[at]) return
      queued[at] = 1
      pending.push(at)
    },
    /** Each slot marked, last first, told to `visit` — no longer marked, so it may be marked again
     *  meanwhile, and is then taken in its turn. */
    drain(visit: (at: number) => void) {
      for (let at = pending.pop(); at !== undefined; at = pending.pop()) {
        queued[at] = 0
        visit(at)
      }
    },
    /** How many slots wait. */
    get count() {
      return pending.length
    },
    /** Bytes of its host table. */
    get byteLength() {
      return queued.byteLength
    },
  }
}
