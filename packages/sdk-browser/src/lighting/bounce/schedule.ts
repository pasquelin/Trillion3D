import { BOUNCE_PROBE_QUEUE } from '../../../../sdk-core/src/bounce/contracts.ts'
import type { ProbePool, ProbeEmit, TableEmit } from '../../../../sdk-core/src/bounce/probePool.ts'
import { ATLAS_WIDTH } from './atlas.ts'
import { PROBE_QUEUE_WORDS, packQueued } from './probes/probeQueueWgsl.ts'
import { TABLE_RECORD_WORDS } from './probes/tableWgsl.ts'

/** Texels of the table written a frame at most: those that change wait for the next frame. */
const TABLE_RECORDS = 4096

/**
 * Probe scheduler: what the GPU does this frame, from what the pool holds.
 *
 * The queue (`probes`) names the probes to trace — their slot, level, cell and whether it is their
 * first trace: the ones that hold nothing yet, up to the queue's capacity and not the budget, then the
 * others by the priority the pool gives them (`ProbePool.probes`), up to the budget in all. The
 * records (`records`) are the texels of the table that changed, which tell the lit passes where each
 * probe is: the first record holds their count. Both are written once for all and refilled in place:
 * a frame allocates nothing.
 */
export function createBounceSchedule(pool: ProbePool) {
  const queue = new Uint32Array(BOUNCE_PROBE_QUEUE * PROBE_QUEUE_WORDS)
  const cells = new Int32Array(queue.buffer)
  const records = new Uint32Array((TABLE_RECORDS + 1) * TABLE_RECORD_WORDS)
  const lanes = new Float32Array(records.buffer)
  let groups = 0,
    written = 0
  const probe: ProbeEmit = (slot, level, x, y, z, fresh) => {
    const at = groups++ * PROBE_QUEUE_WORDS
    queue[at] = packQueued(slot, level, fresh)
    cells[at + 1] = x
    cells[at + 2] = y
    cells[at + 3] = z
  }
  const table: TableEmit = (texel, a, b, c, d) => {
    const at = ++written * TABLE_RECORD_WORDS
    records[at] = texel % ATLAS_WIDTH
    records[at + 1] = Math.floor(texel / ATLAS_WIDTH)
    lanes[at + 2] = a
    lanes[at + 3] = b
    lanes[at + 4] = c
    lanes[at + 5] = d
  }
  return {
    queue,
    records,
    /** Probes queued by the last plan. */
    get groups() {
      return groups
    },
    /** Texels of the table written by the last plan. */
    get texels() {
      return written
    },
    /**
     * Fills the queue and the records of image `frame` for an eye at `viewpoint`, a budget of `budget`
     * probes; returns the probes queued. The texels written are `texels`; a pool with no work queues
     * nothing.
     */
    plan(frame: number, viewpoint: ArrayLike<number>, budget: number) {
      groups = 0
      written = 0
      if (!pool.working) return 0
      pool.probes(frame, viewpoint, BOUNCE_PROBE_QUEUE, budget, probe)
      pool.table(TABLE_RECORDS, table)
      records[0] = written
      return groups
    },
  }
}
