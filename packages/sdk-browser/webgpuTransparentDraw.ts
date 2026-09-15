import { writeCpuTransparentInstances } from './webgpuBlendSelection.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/**
 * Where each transparent cluster's indices live in the page cache, refreshed only when the cache's
 * membership moved. `residencyRevision` rises on every arrival and departure and on nothing else, so
 * a still image rewrites nothing; a cluster whose page left draws no vertex at all rather than the
 * indices of whatever took its slot.
 */
function refreshTransparentSpans(rt: WebgpuPagesRuntime) {
  const { blendState, gpu } = rt,
    { table, compaction } = blendState,
    { packedPages, rows } = rt.layout;
  if (!table || !compaction || !gpu.cache) return;
  const revision = gpu.cache.residencyRevision;
  if (blendState.spanRevision === revision) return;
  blendState.spanRevision = revision;
  const { spans, pageOfEntry } = table,
    offsets = rows.residentOffsetWords;
  for (let entry = 0; entry < table.capacity; entry++) {
    const page = pageOfEntry[entry];
    if (page < 0) continue;
    const offset = offsets[page],
      resident = offset >= 0 && !!packedPages[page].array;
    spans[entry * 2] = resident ? offset : 0;
    spans[entry * 2 + 1] = resident ? packedPages[page].triangles * 3 : 0;
  }
  compaction.uploadSpans();
}

/**
 * The transparent instance lists of one image.
 *
 * On the GPU path the compaction reads the very mask this frame's cluster cut wrote, so the
 * transparents are selected, ordered and counted by the same cut as the opaques, in the same
 * submission. On the CPU path the same buffer is written from the CPU cut instead, in the same
 * table order, and the draw reads it the same way.
 */
export function encodeTransparentInstances(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder) {
  const { blendState, run } = rt,
    { table, compaction } = blendState;
  if (!table || !compaction) return;
  refreshTransparentSpans(rt);
  const selection = run.gpuFrameActive ? run.gpuSelection : undefined;
  if (selection && compaction.encode) {
    compaction.encode(encoder, selection.maskBuffer, selection.maskOffset);
    return;
  }
  writeCpuTransparentInstances(blendState, run.drawn, (rec) => {
    const page = rt.layout.rows.pageIndexOf(rec);
    return page === undefined ? -1 : table.entryOfPage[page];
  });
  compaction.uploadInstances(
    blendState.cpuInstances,
    blendState.cpuInstanceCount,
    blendState.cpuItemCounts,
  );
}
