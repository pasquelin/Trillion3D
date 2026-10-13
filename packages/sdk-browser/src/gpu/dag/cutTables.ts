import { NO_INDEX } from '../../../../math/src/constants.ts'
import type { DagCutLinks } from './types.ts'
import type { DagParts } from './split.ts'
import type { DagResources } from './resources.ts'

/**
 * What a pass beside the cut reads of its tables where they lie (`../../webgpu/rays/rayQuery.ts`):
 * the nodes as the device splits them (`nodeTableWgsl.ts`), the placements' records — every
 * placement's world (`worldTable.ts`) — and the placement tree's (`treeTable.ts`) with its top,
 * node 0, `NO_INDEX` without a tree (a node's worth of table then, which no walk reads), the
 * placements the packing holds live, and the world DAG's placement, `NO_INDEX` without one. Each
 * range's frames are `GpuSelection.worldRanges`.
 */
export type CutTables = {
  nodeParts: DagParts
  worlds: GPUTextureView
  tree: GPUTextureView
  treeRoot: number
  placements: number
  worldPlacement: number
  /** Each placement's first page and group links, its record shift, and the records the packing
   *  holds room for: what names a page's shared record (`layout.ts`, `recordOf`). */
  cutLinks: readonly DagCutLinks[]
  recordShift: Uint32Array
  recordCount: number
}

/** The tables of `resources` as a pass beside the cut reads them (`CutTables`), as they stand now:
 *  the worlds' view is the one a growth of the records made last (`RecordTexture.hold`). */
export const cutTablesOf = ({ nodeParts, frames, treeTable, packed }: DagResources): CutTables => ({
  nodeParts,
  worlds: frames.worlds.view,
  tree: treeTable.view,
  treeRoot: packed.placementTree ? 0 : NO_INDEX,
  placements: packed.live?.worlds ?? packed.worldCount,
  worldPlacement: packed.world?.root ?? NO_INDEX,
  cutLinks: packed.cutLinks,
  recordShift: packed.recordShift,
  recordCount: packed.recordCount,
})
