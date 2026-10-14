import type { WebgpuPagesCore } from '../pages/runtime.ts'
import { rowIndexCount } from '../row/pageRow.ts'
import { writeSpanDeformation } from '../../deformation/outputs.ts'

/** The residency mirror reports only offsets that changed, including eviction and slot reuse. */
export function updateTransparentSpan(rt: WebgpuPagesCore, page: number, offset: number) {
  const { table, dirtySpans } = rt.blendState
  if (!table) return
  // A page the table does not name is never a blended one.
  const entry = table.entryOf(page)
  if (entry < 0) return
  // The page back through the one catalogue accessor: its geometry page declares the corners, or
  // the index page it still draws from does.
  const rec = rt.layout.recordOf(page)
  if (!rec) return
  const count = offset >= 0 ? rowIndexCount(rec) : 0,
    start = count ? offset : 0
  if (table.spans[entry * 4] === start && table.spans[entry * 4 + 1] === count) return
  table.spans[entry * 4] = start
  table.spans[entry * 4 + 1] = count
  writeSpanDeformation(table.spans, entry, rt.layout.deformationOutputOf(page), count)
  dirtySpans.mark(entry)
}

/** Adjacent changed entries share one upload. Opaque arrivals and unchanged frames write nothing. */
export function refreshTransparentSpans(rt: WebgpuPagesCore) {
  const { compaction, dirtySpans } = rt.blendState
  if (!compaction || !dirtySpans.count) return
  const { count, pairs } = dirtySpans.runs()
  for (let r = 0; r < count; r++) {
    const first = pairs[r * 2],
      entries = pairs[r * 2 + 1] - first + 1
    compaction.uploadSpans(first, entries)
    rt.timing.transparentSpanUploadBytes += entries * 16
  }
  dirtySpans.clear()
}
