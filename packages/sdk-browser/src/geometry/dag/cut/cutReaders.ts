import { NO_INDEX } from '../../../../../math/src/constants.ts'
import type { DagCutLinks } from '../types.ts'
import type { DagReadTables } from '../shader/bindings.ts'
import type { DagResources } from '../resources.ts'
import { levelsDispatched } from '../encode.ts'
import { instanceEntries, queueZeroEntries } from '../flagSections.ts'

/**
 * What a pass beside the cut reads of its tables where they lie (`../../../lighting/rays/rayQuery.ts`):
 * the record tables the culling reads — the nodes, the placements' frame words and records, the
 * placement tree —, bound at its bindings whatever the world's size (`../shader/bindings.ts`,
 * `dagReadEntries`); the tree's top, node 0, `NO_INDEX` without a tree (a node's worth of table
 * then, which no walk reads), and the placements the packing holds live.
 */
export type CutTables = {
  views: DagReadTables
  /** The clusters' hot records and the cold words (residency bits, cold records) the cut rule reads
   *  (`../cut/cutTables.ts`): what the shadow casters judge a cluster by, as the cut does. */
  clusters: GPUTextureView
  cold: GPUTextureView
  treeRoot: number
  placements: number
  /** Each placement's first page and group links, its record shift, and the records the packing
   *  holds room for: what names a page's shared record (`../layout.ts`, `recordOf`). */
  cutLinks: readonly DagCutLinks[]
  recordShift: Uint32Array
  recordCount: number
  /** What a page's index adds to reach its cluster record (`../info/clusterInfoLayout.ts`), and the
   *  records the packing holds room for. */
  infoShift: Uint32Array
  infoCount: number
  /** What a descent over other views reads of the cut (`../shader/descentShape.ts`,
   *  `../../../lighting/shadows/vsm/traversal/`): the main view's uniform block as its last cut wrote
   *  it (`../viewLayout.ts`), the levels its descent dispatches (`../encode.ts`), the entries of
   *  queue 0 a view opens and those no node budget bounds (`../flagSections.ts`,
   *  `queueZeroEntries`, `instanceEntries`), the blocks of its pages' masks
   *  (`../shader/blendMaskWgsl.ts`) and the ranks its readout holds. */
  descent: {
    block: Uint32Array
    levels: number
    rootSlots: number
    entries: number
    blockCount: number
    listCap: number
  }
}

/** The tables of `resources` as a pass beside the cut reads them (`CutTables`), as they stand now:
 *  each view the one a growth made last (`RecordTexture.hold`). */
const cutTablesOf = (resources: DagResources): CutTables => {
  const { cutTables, frames, treeTable, packed } = resources
  return {
    views: {
      nodes: cutTables.nodes.view,
      frames: frames.rows.view,
      worlds: frames.worlds.view,
      tree: treeTable.view,
    },
    clusters: cutTables.clusters.view,
    cold: cutTables.cold.view,
    treeRoot: packed.placementTree ? 0 : NO_INDEX,
    placements: packed.live?.worlds ?? packed.worldCount,
    cutLinks: packed.cutLinks,
    recordShift: packed.recordShift,
    recordCount: packed.recordCount,
    infoShift: packed.infoShift,
    infoCount: packed.infoCount,
    descent: {
      block: new Uint32Array(resources.uniformData.buffer),
      levels: levelsDispatched(resources),
      rootSlots: queueZeroEntries(packed),
      entries: instanceEntries(packed),
      blockCount: resources.blockCount,
      listCap: resources.listCap,
    },
  }
}

/**
 * What the passes beside a camera cut read of it (`GpuSelection`): its tables (`cutTables`), read again at each call, none once
 * `live` says it is released.
 */
export function cutReaders({ resources }: { resources: DagResources }, live: () => boolean) {
  return { cutTables: () => (live() ? cutTablesOf(resources) : undefined) }
}
