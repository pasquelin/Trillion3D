import type { DagRoot, PackedDag } from './types.ts'
import { groupParentBase, keyGroupBase, keyWordBase, recordKeyBase } from './layout.ts'
import { joinPlacementTree, joinStart } from './placementTreePack.ts'
import { treeNodeCount } from './placementTree.ts'
import { cullingOf, levelSizesOf, placeRoot, type Packing, type PackShared } from './packRoots.ts'

/** The live ranges `appendDagRoots` filled: pages and placements `[from, to)`, the primitive nodes,
 *  records and content keys of the primitives it brought — none of them for placements of a
 *  primitive the packing held —, and the placement tree's nodes it rewrote and member slots it
 *  filled. */
export type DagAppended = {
  pages: readonly [number, number]
  worlds: readonly [number, number]
  nodes: readonly [number, number]
  records: readonly [number, number]
  /** The keys written or moved: new ones, and those whose coarsest level a new page raised. */
  keys: readonly number[]
  /** The key groups whose parent starts were written, and the edges behind them. */
  groups: readonly [number, number]
  edges: readonly [number, number]
  tree: { nodes: Int32Array; members: readonly [number, number] }
}

/**
 * `roots` packed in place behind the live ones, into the room `packed` kept (`DagCapacity`): each
 * a later placement of a primitive it holds — the page array of a root already packed, or another
 * of the same nodes whose records are the same words —, so its records are that root's and its
 * pages' content keys the canonical ones that root's name; or the first of a primitive it does not
 * hold, whose nodes, records and keys are written behind the live ones, in the room. The tables
 * then read as a packing of every root at that capacity would: the same words, appended.
 * `undefined` when they do not fit — the caller packs them all again, at a grown capacity.
 */
export function appendDagRoots(
  packed: PackedDag,
  roots: readonly DagRoot[],
): DagAppended | undefined {
  const { shared, live } = packed
  if (!shared || !live || !fitsRoom(packed, roots, shared)) return undefined
  const from = { ...live },
    blocks = shared.records!.blocks,
    recordsFrom = shared.records!.count,
    words = new Uint32Array(packed.pageCones.buffer, packed.pageCones.byteOffset),
    tree = packed.placementTree,
    batch: number[] = [],
    keys = shared.keys!
  const p: Packing = {
    ...packed,
    nodeInts: new Uint32Array(packed.nodes.buffer, packed.nodes.byteOffset, packed.nodes.length),
    live,
    shared,
    rootClusters: packed.rootCount,
  }
  for (const root of roots) {
    // Its records are its template's, and their keys with them (`writeKeyTables`), or new ones.
    placeRoot(p, root, live.worlds, (culling, owner, nodeBase) =>
      shared.records!.place(root.pages, culling.nodes, owner, nodeBase),
    )
    const link = p.cutLinks[p.cutLinks.length - 1]
    keys.place(root, link.pageBase, (link.pageBase + p.recordShift[live.worlds - 1]) >>> 0)
    const sizes = levelSizesOf(cullingOf(root), shared),
      shift = tree?.depth ?? 0
    for (let level = 0; level < sizes.length; level++)
      packed.levelSizes[level + shift] += sizes[level]
    ;(packed.worldSources as DagRoot[]).push(root)
    batch.push(live.worlds - 1)
  }
  packed.rootCount = p.rootClusters
  const wrote = keys.flush(words, {
    recordKey: recordKeyBase(packed.pageCount),
    keyWord: keyWordBase(packed),
    keyGroup: keyGroupBase(packed),
    groupParent: groupParentBase(packed),
    groupCapacity: packed.groupCount,
  })
  const recordsTo = shared.records!.count
  shared.records!.finish(packed.clusters, packed.pageCones, shared.coldAt!, blocks)
  // Members of the tree from now on, in new groups (`joinPlacementTree`): their order words sent
  // with the tree nodes they rewrote.
  const joined = tree ? joinPlacementTree(packed, tree, batch) : undefined
  return {
    pages: [from.pages, live.pages],
    worlds: [from.worlds, live.worlds],
    nodes: [from.nodes, live.nodes],
    records: [recordsFrom, recordsTo],
    keys: wrote.keys,
    groups: wrote.groups,
    edges: wrote.edges,
    tree: { nodes: joined?.nodes ?? new Int32Array(0), members: joined?.members ?? [0, 0] },
  }
}

/** The first record of `root`'s pages when they are an earlier placement's: those of the same page
 *  array, or of another array of the same primitive whose records are the same words — a source
 *  wearing another surface —; -1 when the packing holds none of them. */
function recordsOf(root: DagRoot, shared: PackShared) {
  const first = shared.firstOf.get(root.pages)
  if (first) return first.recordBase
  const nodes = root.culling?.nodes,
    block = nodes && shared.nodeBlocks.get(nodes)
  return block ? (shared.records?.find(root.pages, nodes, block.owner, block.nodeBase) ?? -1) : -1
}

/** Whether `roots` fit the room `packed` kept: no deeper than its levels, within its pages, queue
 *  entries and placements — and, for a primitive it does not hold, within the nodes, records and
 *  keys it kept. */
function fitsRoom(packed: PackedDag, roots: readonly DagRoot[], shared: PackShared) {
  const live = packed.live!
  let pages = live.pages,
    entries = live.entries,
    nodes = live.nodes,
    records = shared.records!.count,
    keys = shared.keys!.count,
    groups = shared.keys!.groups,
    edges = shared.keys!.edges
  const brought = new Set<Float64Array>(),
    arrays = new Set<DagRoot['pages']>()
  for (const root of roots) {
    // The world DAG's links are laid out over every placement at once (`packWorldLinks`): it is
    // packed with them all, never appended.
    if (root.origins) return false
    const culling = cullingOf(root),
      shift = packed.placementTree?.depth ?? 0
    if (levelSizesOf(culling, shared).length + shift > packed.levelSizes.length) return false
    const count = culling.nodes.length / culling.stride
    if (!shared.nodeBlocks.has(culling.nodes) && !brought.has(culling.nodes)) {
      brought.add(culling.nodes)
      nodes += count
    }
    // The placements of one source share its page array: its records and keys are written once.
    if (!arrays.has(root.pages) && recordsOf(root, shared) < 0) {
      arrays.add(root.pages)
      records += root.pages.length
      keys += shared.keys!.newKeys(root.pages)
      const most = shared.keys!.mostGroups(root)
      groups += most.groups
      edges += most.edges
    }
    pages += root.pages.length
    entries += count
  }
  // Its member slots take the batch from a new group on (`joinStart`).
  const tree = packed.placementTree
  if (tree && joinStart(tree) + roots.length > tree.capacity) return false
  return (
    pages <= packed.pageCount &&
    entries <= packed.entryCount - treeNodeCount(tree) &&
    live.worlds + roots.length <= packed.worldCount &&
    nodes <= packed.primitiveNodeCount &&
    records <= packed.recordCount &&
    keys <= packed.keyCount &&
    groups <= packed.groupCount &&
    edges <= packed.groupEdges
  )
}
