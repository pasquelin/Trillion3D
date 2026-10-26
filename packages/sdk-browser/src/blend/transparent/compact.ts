import type { TransparentTable } from './table.ts'
import { compactKernels, compactPasses } from './compactPasses.ts'
import { compactBuffers } from './compactBuffers.ts'
import { grownByCopy } from '../../gpu/core/tableGrowth.ts'
import { destroyAll } from '../../gpu/core/errorScope.ts'

export type TransparentCompaction = NonNullable<
  Awaited<ReturnType<typeof createTransparentCompaction>>
>

type Held = ReturnType<typeof compactBuffers>
/** How many table rows and paged items the buffers already hold. */
interface Rows {
  length: number
  items: number
}
/** What the compaction keeps between images: the buffers, those it owns and the table's rows written. */
interface CompactionState {
  held: Held
  buffers: GPUBuffer[]
  rows: Rows
}

/** The table's rows from `state.rows` on written, or all of them in the buffers just made. */
function writeRows(
  device: GPUDevice,
  table: TransparentTable,
  state: CompactionState,
  whole: boolean,
) {
  const { held, rows } = state
  const firstEntry = whole ? 0 : rows.length,
    firstItem = whole ? 0 : rows.items
  const entries = table.length - firstEntry,
    itemWords = (table.pagedItems.length - firstItem) * 2
  if (entries > 0)
    device.queue.writeBuffer(held.entriesBuf, firstEntry * 4, table.entries, firstEntry, entries)
  if (itemWords > 0)
    device.queue.writeBuffer(
      held.itemRangesBuf,
      firstItem * 8,
      table.itemRanges,
      firstItem * 2,
      itemWords,
    )
  if (whole) device.queue.writeBuffer(held.spanBuffer, 0, table.spans)
  state.rows = { length: table.length, items: table.pagedItems.length }
}

/** The compaction's buffers, upload and growth entry points over `state`. */
function compactionApi(
  device: GPUDevice,
  table: TransparentTable,
  state: CompactionState,
  encode: ReturnType<typeof compactPasses> | undefined,
) {
  return {
    get instanceBuffer() {
      return state.held.instanceBuffer
    },
    get occludedBuffer() {
      return state.held.occludedBuffer
    },
    get spanBuffer() {
      return state.held.spanBuffer
    },
    /** The packed page each entry draws, `NO_INDEX` past the table: what names a span's page. */
    get entriesBuffer() {
      return state.held.entriesBuf
    },
    get indirectBuffer() {
      return state.held.indirectBuffer
    },
    encode,
    /** The rows the table gained written; the buffers made over when it outgrew them, which
     *  those that bind them read again (`instanceBuffer`, `indirectBuffer`, …). */
    grow() {
      const outgrown =
        table.capacity > state.held.capacity || table.itemRanges.length > state.held.items * 2
      if (outgrown) {
        const outgrownBuffers = state.buffers
        state.buffers = []
        state.held = compactBuffers(device, table, state.buffers)
        writeRows(device, table, state, true)
        // Retired, not destroyed: the image being encoded may still name them.
        grownByCopy(device, outgrownBuffers)
      } else writeRows(device, table, state, false)
    },
    /** Uploads the spans the last residency change rewrote, and nothing else. */
    uploadSpans(first: number, count: number) {
      device.queue.writeBuffer(
        state.held.spanBuffer,
        first * 16,
        table.spans.buffer,
        first * 16,
        count * 16,
      )
    },
    /** The identity words, one per entry, after the spans in the span buffer. */
    uploadDiagnostic(source: Uint32Array<ArrayBuffer>) {
      device.queue.writeBuffer(state.held.spanBuffer, state.held.identityOffset, source)
    },
    dispose() {
      for (const buffer of state.buffers) buffer.destroy()
    },
  }
}

/**
 * What a transparent draw reads, and the GPU compaction that fills it.
 *
 * Three buffers outlive every image: the span of each cluster in the page cache, the compacted
 * instance list, and the indirect command of each item. Nothing here is rebuilt per image — the
 * spans move only when a page enters or leaves the cache, and the instance list is written by the
 * GPU from the selection mask of the frame being drawn. `encode` is absent on a device that
 * refuses the kernels, which then refuses the scene (`prepareWebgpuPages`).
 *
 * The table grows with the session (`TransparentTable.append`): `grow` writes the rows it added,
 * and the buffers a full table outgrew are made once as long, their rows written from the table's.
 */
export async function createTransparentCompaction(device: GPUDevice, table: TransparentTable) {
  const buffers: GPUBuffer[] = []
  try {
    const kernels = await compactKernels(device)
    const state: CompactionState = {
      held: compactBuffers(device, table, buffers),
      buffers,
      rows: { length: 0, items: 0 },
    }
    writeRows(device, table, state, true)
    const encode = kernels && compactPasses(device, kernels, table, () => state.held)
    return compactionApi(device, table, state, encode)
  } catch {
    destroyAll(buffers)
    return undefined
  }
}
