import type { CutTables } from '../../gpu/dag/cutReaders.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import type { RayRecords } from './rayRecords.ts'

/** What a batch of rays reads where it lies: the cut's tables (`../../gpu/dag/cutReaders.ts`), the
 *  records (`rayRecords.ts`), the page table and its visibility rows, the blended entries and their
 *  spans, the geometry pool's words and the float pool. */
export type RaySources = {
  tables: CutTables
  records: RayRecords
  pageTable: GPUBuffer
  rows: number
  entries: GPUBuffer
  spans: GPUBuffer
  entryCount: number
  geometry: GPUBuffer
  positions: GPUBuffer
}

/** What the session's engine holds for a batch, the queue's records over it: none while it opens,
 *  after a loss or a dispose. */
export function raySourcesOf(rt: WebgpuPagesRuntime, records: RayRecords): RaySources | undefined {
  const { run, gpu, vis, layout, blendState } = rt
  const selection = run.gpuSelection,
    tables = selection?.cutTables(),
    pageTable = vis.pageTable,
    geometry = gpu.cache?.buffer,
    // A scene without float geometry, or without blended entries, binds the zero words in their
    // place.
    zero = vis.zeroFlags,
    positions = vis.concatPos ?? zero,
    compaction = blendState.compaction,
    entries = compaction?.entriesBuffer ?? zero,
    spans = compaction?.spanBuffer ?? zero
  if (run.lost || !selection || !tables || !pageTable || !geometry || !positions) return undefined
  if (!entries || !spans) return undefined
  const entryCount = compaction ? (blendState.table?.length ?? 0) : 0
  return {
    tables,
    records,
    pageTable,
    rows: layout.rows.packedCount,
    entries,
    spans,
    entryCount,
    geometry,
    positions,
  }
}
