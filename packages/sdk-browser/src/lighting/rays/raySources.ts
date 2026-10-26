import type { CutTables } from '../../geometry/dag/cut/cutReaders.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import type { RayRecords } from './rayRecords.ts'

/** What a batch of rays reads where it lies: the cut's tables (`../../geometry/dag/cut/cutReaders.ts`), the
 *  records (`rayRecords.ts`), the decoded clusters of the frame (`pageTable`), the room of their
 *  table (`rows`) and the list of visible clusters whose header counts the ones it holds, the blended
 *  entries and their spans, the geometry pool's words and the float pool. */
export type RaySources = {
  tables: CutTables
  records: RayRecords
  pageTable: GPUBuffer
  visible: GPUBuffer
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
  const { run, gpu, vis, blendState } = rt
  const selection = run.gpuSelection,
    tables = selection?.cutTables(),
    pageTable = vis.pageTable,
    geometry = gpu.cache?.buffer,
    // A scene without float geometry, or without blended entries, binds the zero words in their
    // place.
    zero = vis.zeroRows,
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
    visible: selection.visible,
    rows: selection.visibleCap,
    entries,
    spans,
    entryCount,
    geometry,
    positions,
  }
}
