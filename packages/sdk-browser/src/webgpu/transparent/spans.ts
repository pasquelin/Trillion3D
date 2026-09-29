import type { WebgpuPagesCore } from '../pages/runtime.ts';
import { rowIndexCount } from '../row/pageRow.ts';

/** The residency mirror reports only offsets that changed, including eviction and slot reuse. */
export function updateTransparentSpan(rt: WebgpuPagesCore, page: number, offset: number) {
  const { table, dirtySpans } = rt.blendState;
  if (!table) return;
  // A page past the table joined in place (`../../placement/webgpuGrowth.ts`): never a blended one.
  const entry = table.entryOfPage[page] ?? -1;
  if (entry < 0) return;
  const rec = rt.layout.recordOf(page)!;
  // The corners its geometry page declares, or those of the index page it still draws from.
  const count = offset >= 0 ? rowIndexCount(rec) : 0,
    start = count ? offset : 0;
  if (table.spans[entry * 4] === start && table.spans[entry * 4 + 1] === count) return;
  table.spans[entry * 4] = start;
  table.spans[entry * 4 + 1] = count;
  const output = rec.deformationOutput;
  table.spans[entry * 4 + 2] = count && output ? offset + output.from + 1 : 0;
  table.spans[entry * 4 + 3] = count && output ? output.count : 0;
  dirtySpans.add(entry);
}

/** Adjacent changed entries share one upload. Opaque arrivals and unchanged frames write nothing. */
export function refreshTransparentSpans(rt: WebgpuPagesCore) {
  const { compaction, dirtySpans } = rt.blendState;
  if (!compaction || !dirtySpans.size) return;
  const entries = Array.from(dirtySpans).sort((a, b) => a - b);
  for (let i = 0; i < entries.length;) {
    const first = entries[i++];
    let end = first + 1;
    while (i < entries.length && entries[i] === end) {
      i++;
      end++;
    }
    compaction.uploadSpans(first, end - first);
    rt.timing.transparentSpanUploadBytes += (end - first) * 16;
  }
  dirtySpans.clear();
}
