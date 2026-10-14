import type { TransparentTable } from './table.ts'
import { compactKernels, compactPasses } from './compactPasses.ts'
import { compactBuffers } from './compactBuffers.ts'

export type TransparentCompaction = NonNullable<
  Awaited<ReturnType<typeof createTransparentCompaction>>
>

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
  let buffers: GPUBuffer[] = []
  try {
    const kernels = await compactKernels(device)
    let held = compactBuffers(device, table, buffers)
    let rows = { length: 0, items: 0 }
    /** The table's rows from `rows` on written, or all of them in the buffers just made. */
    const write = (whole: boolean) => {
      const firstEntry = whole ? 0 : rows.length,
        firstItem = whole ? 0 : rows.items
      const entries = table.length - firstEntry,
        itemWords = (table.pagedItems.length - firstItem) * 2
      if (entries > 0)
        device.queue.writeBuffer(
          held.entriesBuf,
          firstEntry * 4,
          table.entries,
          firstEntry,
          entries,
        )
      if (itemWords > 0)
        device.queue.writeBuffer(
          held.itemRangesBuf,
          firstItem * 8,
          table.itemRanges,
          firstItem * 2,
          itemWords,
        )
      if (whole) device.queue.writeBuffer(held.spanBuffer, 0, table.spans)
      rows = { length: table.length, items: table.pagedItems.length }
    }
    write(true)
    const encode = kernels && compactPasses(device, kernels, table, () => held)
    return {
      get instanceBuffer() {
        return held.instanceBuffer
      },
      get occludedBuffer() {
        return held.occludedBuffer
      },
      get spanBuffer() {
        return held.spanBuffer
      },
      /** The packed page each entry draws, `NO_INDEX` past the table: what names a span's page. */
      get entriesBuffer() {
        return held.entriesBuf
      },
      get diagnosticBuffer() {
        return held.diagnosticBuffer
      },
      get indirectBuffer() {
        return held.indirectBuffer
      },
      encode,
      /** The rows the table gained written; the buffers made over when it outgrew them, which
       *  those that bind them read again (`instanceBuffer`, `indirectBuffer`, …). */
      grow() {
        const outgrown = table.capacity > held.capacity || table.itemRanges.length > held.items * 2
        if (outgrown) {
          const outgrownBuffers = buffers
          buffers = []
          held = compactBuffers(device, table, buffers)
          write(true)
          for (const buffer of outgrownBuffers) buffer.destroy()
        } else write(false)
      },
      /** Uploads the spans the last residency change rewrote, and nothing else. */
      uploadSpans(first: number, count: number) {
        device.queue.writeBuffer(
          held.spanBuffer,
          first * 16,
          table.spans.buffer,
          first * 16,
          count * 16,
        )
      },
      uploadDiagnostic(source: Uint32Array<ArrayBuffer>) {
        device.queue.writeBuffer(held.diagnosticBuffer, 0, source)
      },
      dispose() {
        for (const buffer of buffers) buffer.destroy()
      },
    }
  } catch {
    for (const buffer of buffers)
      try {
        buffer.destroy()
      } catch {
        /* Partial transparent compaction setup must not leak. */
      }
    return undefined
  }
}
