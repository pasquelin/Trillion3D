import type { WebgpuPagesCore } from '../pages/runtime.ts';

/** The residency mirror reports only offsets that changed, including eviction and slot reuse. */
export function updateTransparentSpan(rt: WebgpuPagesCore, page: number, offset: number) {
  const { table, dirtySpans } = rt.blendState;
  if (!table) return;
  const entry = table.entryOfPage[page];
  if (entry < 0) return;
  const rec = rt.layout.packedPages[page],
    resident = offset >= 0 && !!rec.array,
    start = resident ? offset : 0,
    count = resident ? rec.triangles * 3 : 0;
  if (table.spans[entry * 2] === start && table.spans[entry * 2 + 1] === count) return;
  table.spans[entry * 2] = start;
  table.spans[entry * 2 + 1] = count;
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
    rt.timing.transparentSpanUploadBytes += (end - first) * 8;
  }
  dirtySpans.clear();
}
