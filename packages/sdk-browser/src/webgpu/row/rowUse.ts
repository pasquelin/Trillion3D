import { EVICT_IN_USE } from '../../gpu/dag/evict.ts'
import { DAG_READBACK_SLOTS } from '../../gpu/dag/layout.ts'

/** Frames a row stays in use after the last readback that named it: the pool's rule
 *  (`EVICT_IN_USE`), past the frames the host reads the cut behind (`DAG_READBACK_SLOTS`) — the GPU
 *  knows the pool's use at each frame, the host knows the rows' only through readbacks, and a row
 *  taken back counts for the frame being drawn. */
const ROW_IN_USE = EVICT_IN_USE + DAG_READBACK_SLOTS

/** The stamp of a row its instance holds: one the cut's closure holds now, never idle. */
const HELD = 0x7fffffff

/**
 * THE ROWS' LAST USE (#1483): what makes the row table a cache of the GPU cut, on the pool's clock
 * (`../../gpu/dag/evict.ts`): the host's frame each readback was cut at. A row is a placement's own,
 * the instance's — the GPU's last uses are the content's, a word a group, shared by every
 * placement —: what names an instance is the readback, the host's to follow. The row of an instance
 * the readbacks' closure holds — drawn, asked or asked ahead, its groups' with it (`rowDemand.ts`)
 * — is held (`hold`): in use whatever the clock; as the instance leaves the closure the row takes
 * the clock's stamp (`release`), so nothing is stamped per readback but what changed. A clock hand
 * sweeps the rows for one unused for `ROW_IN_USE` frames: no cut since drew it and no view wants
 * it, so giving it back costs no pixel the cut draws. A row taken for an instance no cut has named
 * yet (an arrival) is the first a request may take back; one taken for a request counts as used now.
 *
 * One word per row, never per placement. The rows in use are counted by the frame that stamped
 * them, a ring of `ROW_IN_USE` counts, and the held rows by one more: a table whose rows are all in
 * use answers at once, never by a sweep — the full table under a turning camera, every readback. A
 * row given back (`forget`) leaves the count; the table's live rows are exactly those counted, held
 * or idle.
 */
export function createRowUse(capacity: number) {
  const K = ROW_IN_USE
  let stamps = new Int32Array(Math.max(1, capacity)),
    // Started past the idle span: a row never stamped is unused.
    clock = K,
    hand = 0,
    /** Rows stamped at each of the last `K` frames, by stamp modulo `K`, and their sum. */
    inUse = 0,
    /** Rows held (`hold`). */
    held = 0
  const recent = new Int32Array(K)
  /** Row `row` leaves the count of the readback that stamped it, if it is in use. */
  const drop = (row: number) => {
    const at = stamps[row]
    if (at === HELD) return void held--
    if (clock - at >= K) return
    recent[at % K]--
    inUse--
  }
  const use = {
    get clock() {
      return clock
    },
    /** A readback cut at frame `frame` adopted — the next frame by default —: the rows the frames
     *  it passes stamped turn unused. A readback of the frame in hand moves nothing. */
    tick(frame = clock + 1) {
      for (let step = Math.min(K, frame - clock); step > 0; step--) {
        inUse -= recent[(frame - step + 1) % K]
        recent[(frame - step + 1) % K] = 0
      }
      clock = Math.max(clock, frame)
    },
    /** Row `row` was drawn or asked for by the readback just adopted, or taken for a request. */
    stamp(row: number) {
      drop(row)
      stamps[row] = clock
      recent[clock % K]++
      inUse++
    },
    /** Row `row`'s instance is held by the readbacks' closure: in use until `release`. */
    hold(row: number) {
      drop(row)
      stamps[row] = HELD
      held++
    },
    /** Row `row`'s instance left the closure: used by the readback just adopted, aging from now. */
    release(row: number) {
      if (stamps[row] !== HELD) return
      held--
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
      inUse = held = 0
    },
    /** The table holds `rows` rows now: the rows past the old ones were never used. */
    fit(rows: number) {
      if (stamps.length >= rows) return
      const next = new Int32Array(rows).fill(clock - K)
      next.set(stamps)
      stamps = next
    },
    /** The next row of `[0, count)` — the table's live rows — the hand finds unused for
     *  `ROW_IN_USE` frames, or -1 at once when every one is in use. */
    victim(count: number) {
      if (inUse + held >= count) return -1
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
