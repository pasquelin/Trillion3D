import { createChangedRuns } from '../residency/ranges.ts'
import { writeRanges } from '../../gpu/dag/runWrites.ts'
import { ROW_MAP_HEAD } from './rowMapWgsl.ts'
import { sizedBuffer, type BufferMaker } from '../../gpu/core/sizedBuffer.ts'

/** What the row cache's page→row map (`pageState.ts`) wrote since the GPU's copy was last sent:
 *  the slots, or a rebuild of its tables — then sent whole. */
export function createRowMapJournal() {
  const slots = createChangedRuns()
  const journal = {
    slots,
    rebuilt: true,
    onSlot: (at: number) => slots.mark(at),
    onRebuild() {
      journal.rebuilt = true
      slots.clear()
    },
  }
  return journal
}

export type RowMapJournal = ReturnType<typeof createRowMapJournal>

/** The map's two tables, as the sparse map shows them (`../../page/cut/sparseInts.ts`). */
type MapTables = {
  readonly keys: Int32Array<ArrayBuffer>
  readonly values: Int32Array<ArrayBuffer>
}

const words = (a: Int32Array<ArrayBuffer>) => new Uint32Array(a.buffer, a.byteOffset, a.length)

/**
 * THE GPU'S COPY OF THE PAGE→ROW MAP (`rowMapWgsl.ts`): the slot count, the keys, the values, one
 * storage buffer. `upload` sends what the journal names before the frame's commands — the slots
 * written, by runs (`writeRanges`), or the tables whole after a rebuild —; the buffer is made anew
 * only when a growth outgrows it, O(log) times, and `upload` says so: the bind groups follow. No
 * second hash and no mirror on the host: the map is the cache's own. The CPU never reads it back.
 */
export function createRowMapGpu(
  device: GPUDevice,
  map: MapTables,
  journal: RowMapJournal,
  /** Makes its buffer, in place of the one it outgrew: the cut's (`cutBuffer`). */
  make: BufferMaker,
) {
  let buffer: GPUBuffer | undefined,
    slots = -1
  const target = (offset: number, data: ArrayBuffer, from: number, size: number) =>
    device.queue.writeBuffer(buffer!, offset, data, from, size)
  const whole = () => {
    const n = map.keys.length,
      bytes = (ROW_MAP_HEAD + 2 * Math.max(1, n)) * 4,
      held = buffer,
      usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    buffer = sizedBuffer(device, held, bytes, usage, 'Trillion3D DAG row map', make)
    device.queue.writeBuffer(buffer, 0, new Uint32Array([n]))
    if (n) {
      device.queue.writeBuffer(buffer, ROW_MAP_HEAD * 4, words(map.keys))
      device.queue.writeBuffer(buffer, (ROW_MAP_HEAD + n) * 4, words(map.values))
    }
    slots = n
    journal.rebuilt = false
    journal.slots.clear()
    return buffer !== held
  }
  return {
    /** Sends what the map wrote since the last call; true when the buffer was made anew. */
    upload() {
      if (journal.rebuilt || slots !== map.keys.length) return whole()
      if (!journal.slots.count) return false
      const sorted = journal.slots.take()
      for (const [table, base] of [
        [map.keys, ROW_MAP_HEAD],
        [map.values, ROW_MAP_HEAD + slots],
      ] as const)
        writeRanges(target, sorted, sorted.length, {
          data: words(table),
          sourceBase: 0,
          targetBase: base,
          stride: 1,
        })
      return false
    },
    /** The buffer the closure binds (`rowOfPage`), made at the first `upload`. */
    get buffer() {
      return buffer
    },
  }
}
