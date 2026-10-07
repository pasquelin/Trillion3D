import { DAG_READBACK_SLOTS } from '../../gpu/dag/layout.ts'

/**
 * Readbacks a row stays unused before a request may take it back: four times the readbacks a row
 * can still be drawn from after the last one that named it — the slots in flight and the image
 * being encoded —, so a camera that turns away and back keeps its rows.
 */
const ROW_IDLE_READBACKS = 4 * (DAG_READBACK_SLOTS + 1)

/**
 * THE ROWS' LAST USE (#1483): what makes the row table a cache of the GPU cut. Each readback the
 * host adopts moves a clock and stamps the rows of the instances it drew or asked for
 * (`rowDemand.ts`). A clock hand sweeps the rows for one unused for `ROW_IDLE_READBACKS`
 * readbacks: no image since drew it and no view wants it, so giving it back costs no pixel the cut
 * draws. A row taken for an instance no cut has named yet (an arrival) is the first a request may
 * take back; one taken for a request counts as used now.
 *
 * One word per row, never per placement. The rows in use are counted by the readback that stamped
 * them, a ring of `ROW_IDLE_READBACKS` counts: a table whose rows are all in use answers at once,
 * never by a sweep — the full table under a turning camera, every readback. A row given back
 * (`forget`) leaves the count; the table's live rows are exactly those counted or idle.
 */
export function createRowUse(capacity: number) {
  const K = ROW_IDLE_READBACKS
  let stamps = new Int32Array(Math.max(1, capacity)),
    // Started past the idle span: a row never stamped is unused.
    clock = K,
    hand = 0,
    /** Rows stamped at each of the last `K` readbacks, by stamp modulo `K`, and their sum. */
    inUse = 0
  const recent = new Int32Array(K)
  /** Row `row` leaves the count of the readback that stamped it, if it is in use. */
  const drop = (row: number) => {
    const at = stamps[row]
    if (clock - at >= K) return
    recent[at % K]--
    inUse--
  }
  const use = {
    get clock() {
      return clock
    },
    /** One readback more adopted: the rows the oldest counted readback stamped turn unused. */
    tick() {
      clock++
      inUse -= recent[clock % K]
      recent[clock % K] = 0
    },
    /** Row `row` was drawn or asked for by the readback just adopted, or taken for a request. */
    stamp(row: number) {
      drop(row)
      stamps[row] = clock
      recent[clock % K]++
      inUse++
    },
    /** Row `row` was taken for an instance no cut has named: the first a request takes back. */
    idle(row: number) {
      drop(row)
      stamps[row] = clock - K
    },
    /** Row `row` was given back: free, it is in no count. */
    forget(row: number) {
      use.idle(row)
    },
    /** Row `from` moved to free rank `to`, its use with it. */
    moved(from: number, to: number) {
      stamps[to] = stamps[from]
      stamps[from] = clock - K
    },
    /** Every row given back at once: a new table. */
    reset() {
      stamps.fill(clock - K)
      recent.fill(0)
      inUse = 0
    },
    /** The table holds `rows` rows now: the rows past the old ones were never used. */
    fit(rows: number) {
      if (stamps.length >= rows) return
      const next = new Int32Array(rows).fill(clock - K)
      next.set(stamps)
      stamps = next
    },
    /** The next row of `[0, count)` — the table's live rows — the hand finds unused for
     *  `ROW_IDLE_READBACKS`, or -1 at once when every one is in use. */
    victim(count: number) {
      if (inUse >= count) return -1
      for (let step = 0; step < count; step++) {
        if (hand >= count) hand = 0
        const row = hand++
        if (clock - stamps[row] >= K) return row
      }
      return -1
    },
    /** Bytes of the stamps: one word per row. */
    get bytes() {
      return stamps.byteLength + recent.byteLength
    },
  }
  return use
}

export type RowUse = ReturnType<typeof createRowUse>
