import type { DagResources, RowCutPass } from '../../gpu/dag/resources.ts'
import { structuresOf } from '../../gpu/dag/structureTable.ts'
import { SELECTION_HEADER_WORDS, rowBurst, rowQueueWord } from '../../gpu/dag/readoutWords.ts'
import { cutBuffer, cutTexture } from '../../gpu/dag/cutBuffers.ts'
import { createRowMapGpu, type RowMapJournal } from './rowMapGpu.ts'
import { createRowWordsGpu, type RowWords } from './rowWords.ts'
import { createRowClosure } from './rowClosure.ts'
import { createRowEvictSort } from './rowEvictSort.ts'

/** What the GPU reads of the row cache (`slots.ts`): the page→row map and its journal
 *  (`pageState.ts`), the use words (`rowWords.ts`), the table's rows, and the host's frame; and
 *  where the queues the GPU ranks go (`order`): its pages, first victim first — read at once, the
 *  readback they lie in is mapped no longer —, the rows ranked in all and the frame it was ranked
 *  at; `undefined` for a readback whose queue is not to be trusted. */
type RowsHost = {
  map: {
    tables: { readonly keys: Int32Array<ArrayBuffer>; readonly values: Int32Array<ArrayBuffer> }
    journal: RowMapJournal
  }
  words: RowWords
  table: { readonly blendFirst: number; readonly packedCount: number }
  frame: () => number
  order(queue: Uint32Array | undefined, ranked: number, frame: number): void
}

/** Frames a cut's readback lands behind it at most, with room (`DAG_READBACK_SLOTS`). */
const FRAMES = 8

/**
 * THE ROW CACHE ON A CUT (#1527): what the cut encodes for its rows after its own kernels
 * (`../../gpu/dag/encode.ts`). The page→row map and the use words the host wrote since the last cut
 * are sent first, in the queue's order before the frame's commands; then the rows' closure stamps
 * every row the cut's pages need (`rowClosure.ts`); then, when a readback copies the cut and the
 * table has fewer free rows than a burst, the pool sort ranks the live rows into the readout
 * (`rowEvictSort.ts`) — only on stamps the closure laid this cut. A readback brings the queue back
 * (`landed`): one the cut ranked is handed on, one from a cut that dropped work or ranked none on
 * stamps of its own is not trusted. Its buffers and texture are the cut's: admitted within its
 * share as its tables are (`cutBuffer`, `cutTexture`), gone with them.
 */
export function createRowEviction(host: RowsHost) {
  return (cut: DagResources): RowCutPass => {
    const { device } = cut
    // Each buffer and texture the cut's own, admitted within its share (`cutBuffer`).
    const buffer = (d: GPUBufferDescriptor, old?: GPUBuffer) => cutBuffer(cut, d, old)
    const map = createRowMapGpu(device, host.map.tables, host.map.journal, buffer),
      use = createRowWordsGpu(device, buffer),
      closure = createRowClosure(device, cut, (d, bytes, old) => cutTexture(cut, d, bytes, old)),
      sort = createRowEvictSort(device, buffer)
    /** Per frame of the last `FRAMES`, whether its cut ranked a queue on its own stamps, or could
     *  not stamp: a queue is read back only from the first. */
    const ranked = new Int32Array(FRAMES).fill(-1),
      unstamped = new Int32Array(FRAMES).fill(-1)
    /** Sends what the host wrote. */
    const upload = () => {
      map.upload()
      const { blendFirst, packedCount } = host.table
      use.upload(host.words, blendFirst, packedCount, host.frame())
    }
    /** Uploads, stamps and — read back and short of a burst of free rows — ranks; false when the
     *  closure could not run. */
    const stampAndRank = (pass: GPUComputePassEncoder, read: boolean, frame: number) => {
      upload()
      const rows = { map: map.buffer!, use: use.buffer! }
      if (!closure.encode(pass, cut.dispatchArgs, rows, structuresOf(cut.packed))) return false
      const { blendFirst, packedCount } = host.table,
        burst = rowBurst(cut.listCap)
      if (!read || blendFirst - packedCount >= burst) return true
      const at = {
        ...{ use: rows.use, out: cut.output, queueAt: rowQueueWord(cut.listCap) },
        ...{ clock: frame, slots: packedCount, burst },
      }
      if (sort.encode(pass, at)) ranked[frame % FRAMES] = frame
      return true
    }
    return {
      encode(pass, read) {
        const frame = host.frame()
        try {
          if (!stampAndRank(pass, read, frame)) unstamped[frame % FRAMES] = frame
        } catch {
          // A buffer the session's budget refused: no stamp this cut, so no queue to trust.
          unstamped[frame % FRAMES] = frame
        }
      },
      landed(range, listCap, frame) {
        // A cut whose closure could not run ranks nothing to trust, whatever its readout holds.
        const slot = ((frame % FRAMES) + FRAMES) % FRAMES
        if (!range || unstamped[slot] === frame) return host.order(undefined, 0, frame)
        if (ranked[slot] !== frame) return
        const at = rowQueueWord(listCap)
        if (range.byteLength < (at + SELECTION_HEADER_WORDS) * 4) return
        const head = new Uint32Array(range, at * 4, SELECTION_HEADER_WORDS)
        // The queue this very cut ranked: its clock is the cut's frame.
        if (head[2] !== frame + 1) return
        const count = Math.min(head[0], rowBurst(listCap))
        if (range.byteLength < (at + SELECTION_HEADER_WORDS + count) * 4) return
        host.order(new Uint32Array(range, (at + SELECTION_HEADER_WORDS) * 4, count), head[1], frame)
      },
    }
  }
}
