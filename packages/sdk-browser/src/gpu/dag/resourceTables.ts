import type { PackedDag } from './types.ts'
import { cameraCutBuffers, makeDagBuffer, type DagBufferRow } from './bufferTable.ts'
import { writeParts, type DagParts } from './split.ts'

export type Own = (descriptor: GPUBufferDescriptor) => GPUBuffer

/** The cut's tables, each as its parts (`split.ts`), and its work layout. The compacted
 *  drawable-page list extends the snapshot: a header, then the ranks. One contiguous copy reports
 *  both. Each is bounded by the CEILING and not by the catalogue: that is what the frame copies and
 *  maps, and the worst case never happens (`layout.ts`, measured by
 *  `tests/gpu/dag/cut-snapshot.gpu.ts`); a cut that keeps more grows it (`listCap.ts`). */
export function dagTables(device: GPUDevice, packed: PackedDag, own: Own) {
  // The buffers, the kernel's block count and the layout of `work`, one table with the device
  // check (`bufferTable.ts`): the list counters live behind the blocks in `work`, where the arming
  // kernel reads them (`arm.ts`).
  const cut = cameraCutBuffers(packed, device.limits),
    { parts } = cut
  /** A table's buffers, one per part (`split.ts`): the first at the table's own binding. */
  const make = (list: DagBufferRow[]) => list.map((row) => makeDagBuffer(own, row))
  return {
    ...cut,
    clusters: make(parts.clusters),
    nodes: make(parts.nodes),
    // Descent queue 0, then draw flags, then the cone word `dagWanted` keeps for `dagMask` (the
    // cone verdict and the cut rule's two comparisons), then the live-cluster list, then the
    // candidate list — which also serves as the previous frame's drawn journal —, then the
    // remaining queues, then each page's last use (`shader/lastUseWgsl.ts`): never read by the
    // CPU, which still only copies draw flags. Split, each part holds whole sections: the draw
    // mask lies in one (`split.ts`).
    flags: make(parts.flags),
    cold: make(parts.pageCones),
  }
}

/** The group the cut's kernels bind: each table's first part at its own binding, the others as
 *  parts (`split.ts`). */
export function dagGroup(
  tables: ReturnType<typeof dagTables>,
  views: GPUBuffer,
  out: GPUBuffer,
  work: GPUBuffer,
) {
  const [clusters] = tables.clusters,
    [nodes] = tables.nodes,
    [flags] = tables.flags,
    [cold] = tables.cold
  return {
    clusters,
    nodes,
    views,
    flags,
    out,
    work,
    cold,
    parts: {
      clusters: tables.clusters.slice(1),
      nodes: tables.nodes.slice(1),
      cold: tables.cold.slice(1),
      flags: tables.flags.slice(1),
    },
  }
}

/** The packed tables written to their parts: each part its own span; a buffer past its table's
 *  bytes (a least size) starts zeroed. */
export function uploadDagTables(
  device: GPUDevice,
  packed: PackedDag,
  tables: ReturnType<typeof dagTables>,
) {
  const { parts } = tables
  /** A table as its parts: what a host write spans (`writeParts`). */
  const partsOf = (buffers: GPUBuffer[], list: DagBufferRow[]): DagParts => ({
    buffers,
    bytes: buffers.length > 1 ? list[0].size : Number.MAX_SAFE_INTEGER,
  })
  const nodeParts = partsOf(tables.nodes, parts.nodes),
    coldParts = partsOf(tables.cold, parts.pageCones)
  for (const [target, source] of [
    [partsOf(tables.clusters, parts.clusters), packed.clusters],
    [nodeParts, packed.nodes],
    [coldParts, packed.pageCones],
  ] as const) {
    const { buffer, byteOffset, byteLength } = source
    writeParts(device, target, 0, buffer as ArrayBuffer, byteOffset, byteLength)
  }
  return { nodeParts, coldParts }
}
