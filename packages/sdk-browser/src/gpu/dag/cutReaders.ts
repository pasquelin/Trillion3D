import { NO_INDEX } from '../../../../math/src/constants.ts'
import type { DagCutLinks } from './types.ts'
import type { DagReadTables } from './shader/bindings.ts'
import type { DagResources } from './resources.ts'
import type { ProxyInstances } from './proxyInstances.ts'

/** What a program reads the proxy through (`proxyInstances.ts`): its buffer, and the cut's record
 *  tables, read where they lie — the placements' records, the worlds it places its meshes by and its
 *  instances (`worldTable.ts`), and the placement tree its rays walk (`treeTable.ts`). */
export type ProxyResources = {
  readonly buffer: GPUBuffer
  readonly worlds: GPUTextureView
  readonly tree: GPUTextureView
  /** Writes to what a ray meets so far (`proxyInstances.ts`): the reflections' answers of before are of
   *  another epoch when this moved (`../../reflections/proxyStore.ts`). */
  readonly writes: number
}

/**
 * What a pass beside the cut reads of its tables where they lie (`../../webgpu/rays/rayQuery.ts`):
 * the record tables the culling reads — the nodes, the placements' frame words and records, the
 * placement tree —, bound at its bindings whatever the world's size (`shader/bindings.ts`,
 * `dagReadEntries`); the tree's top, node 0, `NO_INDEX` without a tree (a node's worth of table
 * then, which no walk reads), the placements the packing holds live, and the world DAG's placement,
 * `NO_INDEX` without one.
 */
export type CutTables = {
  views: DagReadTables
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
 *  each view the one a growth made last (`RecordTexture.hold`). */
const cutTablesOf = ({ cutTables, frames, treeTable, packed }: DagResources): CutTables => ({
  views: {
    nodes: cutTables.nodes.view,
    frames: frames.rows.view,
    worlds: frames.worlds.view,
    tree: treeTable.view,
  },
  treeRoot: packed.placementTree ? 0 : NO_INDEX,
  placements: packed.live?.worlds ?? packed.worldCount,
  worldPlacement: packed.world?.root ?? NO_INDEX,
  cutLinks: packed.cutLinks,
  recordShift: packed.recordShift,
  recordCount: packed.recordCount,
})

/**
 * What the passes beside a camera cut read of it (`GpuSelection`): its tables (`cutTables`) and the
 * proxy (`proxy`), each read again at every call, none once `live` says it is released — a proxy
 * none until a placement wears one, made again when its buffer or the records it reads are.
 */
export function cutReaders(
  { resources, proxies }: { resources: DagResources; proxies: ProxyInstances },
  live: () => boolean,
) {
  let proxy: ProxyResources | undefined
  return {
    cutTables: () => (live() ? cutTablesOf(resources) : undefined),
    proxy() {
      const buffer = live() ? proxies.buffer() : undefined,
        worlds = resources.frames.worlds.view
      if (!buffer) return undefined
      if (proxy?.buffer !== buffer || proxy.worlds !== worlds)
        proxy = {
          buffer,
          worlds,
          tree: resources.treeTable.view,
          get writes() {
            return proxies.writes
          },
        }
      return proxy
    },
  }
}
