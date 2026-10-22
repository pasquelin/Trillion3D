import type { DagRoot, PackedDag } from '../types.ts'
import { coldBase } from '../layout.ts'
import { joinPlacementTree, joinStart } from '../placement/placementTreePack.ts'
import { treeNodeCount } from '../placement/placementTree.ts'
import { cullingOf, levelSizesOf, placeRoot, type Packing, type PackShared } from './packRoots.ts'
import { countRoots } from './packCapacity.ts'

/** The live ranges `appendDagRoots` filled: pages and placements `[from, to)`, the primitive nodes
 *  and records of the primitives it brought — none of them for placements of a primitive the
 *  packing held —, and the placement tree's nodes it rewrote and member slots it filled. */
export type DagAppended = {
  pages: readonly [number, number]
  worlds: readonly [number, number]
  nodes: readonly [number, number]
  records: readonly [number, number]
  tree: { nodes: Int32Array; members: readonly [number, number] }
}

/**
 * `roots` packed in place behind the live ones, into the room `packed` kept (`DagCapacity`): each
 * a later placement of a primitive it holds — the page array of a root already packed, or another
 * of the same nodes whose records are the same words —, so its records are that root's; or the
 * first of a primitive it does not hold, whose nodes and records are written behind the live ones,
 * in the room. The tables then read as a packing of every root at that capacity would: the same
 * words, appended. `undefined` when they do not fit — the caller packs them all again, at a grown
 * capacity.
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
    tree = packed.placementTree,
    batch: number[] = []
  const p: Packing = {
    ...packed,
    nodeInts: new Uint32Array(packed.nodes.buffer, packed.nodes.byteOffset, packed.nodes.length),
    live,
    shared,
    rootClusters: packed.rootCount,
  }
  for (const root of roots) {
    // Its records are its template's, or new ones.
    placeRoot(p, root, live.worlds, (culling, owner, nodeBase) =>
      shared.records!.place(root.pages, culling.nodes, owner, nodeBase),
    )
    const sizes = levelSizesOf(cullingOf(root), shared),
      shift = tree?.depth ?? 0
    for (let level = 0; level < sizes.length; level++)
      packed.levelSizes[level + shift] += sizes[level]
    const sources = packed.worldSources as DagRoot[]
    sources.push(root)
    batch.push(live.worlds - 1)
  }
  packed.rootCount = p.rootClusters
  // The distances' column, when a placement appended is the first to name one.
  packed.drawDistance = p.drawDistance
  const recordsTo = shared.records!.count
  shared.records!.finish(packed.clusters, packed.coldWords, coldBase(packed.pageCount), blocks)
  // Members of the tree from now on, in new groups (`joinPlacementTree`): their order words sent
  // with the tree nodes they rewrote.
  const joined = tree ? joinPlacementTree(packed, tree, batch) : undefined
  return {
    pages: [from.pages, live.pages],
    worlds: [from.worlds, live.worlds],
    nodes: [from.nodes, live.nodes],
    records: [recordsFrom, recordsTo],
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
 *  entries and placements — and, for a primitive it does not hold, within the nodes and records it
 *  kept. */
function fitsRoom(packed: PackedDag, roots: readonly DagRoot[], shared: PackShared) {
  // The world DAG's links are laid out over every placement at once (`packWorldLinks`): it is
  // packed with them all, never appended.
  if (roots.some((root) => root.hlod)) return false
  const live = packed.live!,
    shift = packed.placementTree?.depth ?? 0,
    added = countRoots(
      roots,
      shared,
      () => shift,
      (nodes) => shared.nodeBlocks.has(nodes),
    )
  if (added.levels.length > packed.levelSizes.length) return false
  const pages = live.pages + added.pages,
    entries = live.entries + added.entries,
    nodes = live.nodes + added.nodes
  let records = shared.records!.count
  const arrays = new Set<DagRoot['pages']>()
  for (const root of roots)
    // The placements of one source share its page array: its records are written once.
    if (!arrays.has(root.pages) && recordsOf(root, shared) < 0) {
      arrays.add(root.pages)
      records += root.pages.length
    }
  // Its member slots take the batch from a new group on (`joinStart`).
  const tree = packed.placementTree
  if (tree && joinStart(tree) + roots.length > tree.capacity) return false
  return (
    pages <= packed.pageCount &&
    entries <= packed.entryCount - treeNodeCount(tree) &&
    live.worlds + roots.length <= packed.worldCount &&
    nodes <= packed.primitiveNodeCount &&
    records <= packed.recordCount
  )
}
