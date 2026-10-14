import { EngineError } from '../../../../sdk-core/src/contracts/cache.ts'
import type { PlacementIndex } from '../../page/selection/placements.ts'
import {
  DAG_NODE_FLOATS,
  type DagCutLinks,
  type DagPackShared,
  type DagRoot,
  type PackedDag,
} from './types.ts'
import { baseOpen, linksFor } from '../../page/cut/links.ts'
import { cullingBoundsFor, packCullingNodes } from './packNodes.ts'
import { hierarchyLevelSizes } from './hierarchy.ts'
import { NO_INDEX } from '../../../../math/src/constants.ts'
import type { DagCapacity } from './packCapacity.ts'

/** A ROOT PLACED IN A PACKING (`pack.ts`): its primitive's nodes, shared by its placements, its
 *  world, mark and links, and the shift that leads its pages to their records. */

/** The first page of a placement the room holds and no root filled: past every page. */
const ROOM_BASE = 0x7fffffff

export type Culling = NonNullable<DagRoot['culling']>

export type PackShared = DagPackShared
export const emptyShared = (): PackShared => ({
  levelSizesOf: new Map(),
  boundsOf: new Map(),
  firstOf: new Map(),
  nodeBlocks: new Map(),
})

/** The tables a packing writes a root into, and its live counts (`placeRoot`). */
export type Packing = Pick<
  PackedDag,
  'nodes' | 'worlds' | 'rootNodes' | 'rootBases' | 'mark' | 'recordShift'
> & {
  nodeInts: Uint32Array
  pageIndex: PlacementIndex
  cutLinks: DagCutLinks[]
  live: NonNullable<PackedDag['live']>
  shared: PackShared
  rootClusters: number
}

/** Every root descends the hierarchy its pages were built with, by the one builder
 *  (`page-codec-wasm/src/culling.rs`): a compiled primitive's manifest, the world DAG's, a run-time
 *  cut's. A root without one comes from a cache older than the cut it is packed for. */
export function cullingOf(root: DagRoot) {
  if (root.culling) return root.culling
  throw new EngineError('STALE_CACHE', 'A cluster root without its culling hierarchy: recompile', {
    pages: root.pages.length,
  })
}

/** A node array's level sizes, walked once per array: every placement of a primitive shares it. */
export function levelSizesOf(culling: Culling, shared: PackShared) {
  let sizes = shared.levelSizesOf.get(culling.nodes)
  if (!sizes) {
    sizes = hierarchyLevelSizes(culling.nodes, culling.stride)
    shared.levelSizesOf.set(culling.nodes, sizes)
  }
  return sizes
}

/**
 * The nodes of `root`'s primitive in the node table, packed behind the live ones at its first
 * placement and shared by every later one: each node's first page counted from the primitive's,
 * its open count the DAG's with nothing resident (`baseOpen`), and the node owning each page.
 */
function nodeBlockOf(p: Packing, root: DagRoot, culling: Culling) {
  const known = p.shared.nodeBlocks.get(culling.nodes)
  if (known) return known
  const count = root.pages.length,
    nodeBase = p.live.nodes,
    owner = new Uint32Array(count).fill(NO_INDEX)
  const bounds = cullingBoundsFor(culling, root.pages, p.shared.boundsOf)
  const open = root.structure && baseOpen(linksFor(culling, count), root.structure)
  const place = { nodeBase, pageBase: 0 }
  const nodeCount = packCullingNodes(p.nodes, p.nodeInts, culling, bounds, place, owner, open)
  const block = { nodeBase, nodeCount, owner }
  p.shared.nodeBlocks.set(culling.nodes, block)
  p.live.nodes += nodeCount
  return block
}

/**
 * Root `root` packed as placement `w`, behind the live pages: its world, root node — its
 * primitive's, shared — and mark, its links, its pages' placement words, and the shift that leads
 * its pages to their records, the first record `recordBase` gives for its owner nodes.
 */
export function placeRoot(
  p: Packing,
  root: DagRoot,
  w: number,
  recordBase: (culling: Culling, owner: Uint32Array, nodeBase: number) => number,
) {
  const culling = cullingOf(root),
    pageBase = p.live.pages,
    count = root.pages.length
  const { nodeBase, nodeCount, owner } = nodeBlockOf(p, root, culling)
  p.worlds.set(root.world.elements, w * 16)
  p.rootBases[w] = nodeBase
  p.rootNodes[w] = root.parked ? NO_INDEX : nodeBase
  p.mark[w] = root.mark ?? 0
  const links = linksFor(culling, count)
  const { structure } = root
  p.cutLinks.push({ structure, links, pageBase, pageCount: count, nodeBase, nodeCount })
  // A page array placed before, on the same nodes, has its records: one lookup, no record written.
  let first = p.shared.firstOf.get(root.pages)
  const base =
    first?.nodes === culling.nodes ? first.recordBase : recordBase(culling, owner, nodeBase)
  if (!first)
    p.shared.firstOf.set(
      root.pages,
      (first = {
        pageBase,
        recordBase: base,
        nodes: culling.nodes,
        rootClusters: rootClusterCount(root),
      }),
    )
  p.recordShift[w] = (base - pageBase) >>> 0
  p.pageIndex.baseOfRoot[w] = pageBase
  p.rootClusters += first.rootClusters
  p.live.pages += count
  p.pageIndex.packedCount = p.live.pages
  p.live.entries += nodeCount
  p.live.worlds = w + 1
}

/** The pages of `root` whose parent error is not finite: the clusters a view starts a descent on. */
function rootClusterCount(root: DagRoot) {
  let count = 0
  for (const rec of root.pages)
    if (!(typeof rec.parentError === 'number' && Number.isFinite(rec.parentError))) count++
  return count
}

/** A packing's tables at `capacity`: every placement past the live ones parked, every page past
 *  them in no placement (`NO_INDEX`). */
export function allocatePacking(capacity: DagCapacity, shared: PackShared): Packing {
  const nodes = new Float32Array(Math.max(1, capacity.nodes) * DAG_NODE_FLOATS),
    worldSlots = Math.max(1, capacity.worlds)
  return {
    nodes,
    nodeInts: new Uint32Array(nodes.buffer),
    // Each placement's first page; the room past the live ones names no page (`rootOfPacked`).
    pageIndex: { baseOfRoot: new Int32Array(worldSlots).fill(ROOM_BASE), packedCount: 0 },
    worlds: new Float32Array(worldSlots * 16),
    recordShift: new Uint32Array(worldSlots),
    // Each primitive's root, which prepare deposits in pass 0's queue; a parked row deposits none,
    // and `rootBases` keeps the node it takes back.
    rootNodes: new Uint32Array(worldSlots).fill(NO_INDEX),
    rootBases: new Uint32Array(worldSlots).fill(NO_INDEX),
    // The whole frame word: the mark's bits, and the deformation reach above them (`markReach`).
    mark: new Uint32Array(worldSlots),
    cutLinks: [],
    live: { pages: 0, nodes: 0, worlds: 0, entries: 0 },
    shared,
    rootClusters: 0,
  }
}
