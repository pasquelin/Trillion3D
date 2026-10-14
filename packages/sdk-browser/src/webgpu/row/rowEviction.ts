import type { DagResources, RowCutPass } from '../../gpu/dag/resources.ts'
import { structuresOf } from '../../gpu/dag/structureTable.ts'
import { createRowMapGpu, type RowMapJournal } from './rowMapGpu.ts'
import { createRowWordsGpu, type RowWords } from './rowWords.ts'
import { createRowClosure } from './rowClosure.ts'

/** What the GPU reads of the row cache (`slots.ts`): the page→row map and its journal
 *  (`pageState.ts`), the use words (`rowWords.ts`), the table's rows, and the host's frame. */
type RowsHost = {
  map: {
    tables: { readonly keys: Int32Array; readonly values: Int32Array }
    journal: RowMapJournal
  }
  words: RowWords
  table: { readonly blendFirst: number; readonly packedCount: number }
  frame: () => number
}

/** `next` in `cut`'s buffers in place of `old`: its dispose destroys what the pass made. */
function adopt(cut: DagResources, next: GPUBuffer | undefined, old: GPUBuffer | undefined) {
  if (old) {
    const at = cut.buffers.indexOf(old)
    if (at >= 0) cut.buffers.splice(at, 1)
  }
  if (next) cut.buffers.push(next)
}

/**
 * THE ROW CACHE ON A CUT (#1527): what the cut encodes for its rows after its own kernels
 * (`../../gpu/dag/encode.ts`). The page→row map and the use words the host wrote since the last cut
 * are sent first, in the queue's order before the frame's commands; then the rows' closure stamps
 * every row the cut's pages need (`rowClosure.ts`). Its buffers are the cut's: made beside its
 * tables, gone with them.
 */
export function createRowEviction(host: RowsHost) {
  return (cut: DagResources): RowCutPass => {
    const { device } = cut
    const map = createRowMapGpu(device, host.map.tables, host.map.journal),
      use = createRowWordsGpu(device),
      closure = createRowClosure(device, cut)
    /** Sends what the host wrote: a buffer made anew takes the old one's place in the cut's. */
    const upload = () => {
      const oldMap = map.buffer,
        oldUse = use.buffer
      if (map.upload()) adopt(cut, map.buffer, oldMap)
      const { blendFirst, packedCount } = host.table
      if (use.upload(host.words, blendFirst, packedCount, host.frame()))
        adopt(cut, use.buffer, oldUse)
    }
    return {
      encode(pass) {
        upload()
        const rows = { map: map.buffer!, use: use.buffer! }
        closure.encode(pass, cut.dispatchArgs, rows, structuresOf(cut.packed), cut)
      },
    }
  }
}
