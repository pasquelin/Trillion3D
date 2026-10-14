import { grownLength } from '../../../../math/src/sequence/resized.ts'
import type { DagRoot } from './types.ts'
import { placementTreeShape, treeNodeCount } from './placementTree.ts'
import { cullingOf, emptyShared, levelSizesOf, type PackShared } from './packRoots.ts'

/** WHAT A PACKING HOLDS BEFORE ANY ROOT IS WRITTEN (`pack.ts`): its room, its live counts, its
 *  placement tree and its levels. */

/** Room a packing keeps past its live pages, queue entries (`nodes`: a placement's node each) and
 *  placements, for roots a growth appends (`appendDagRoots`): inert — no root names them — until
 *  one does. Placements of packed primitives add no node: they share theirs. */
export type DagCapacity = {
  pages: number
  nodes: number
  worlds: number
  /** Primitive nodes, records and content keys past the live ones, for the primitives a growth
   *  brings (`appendDagRoots`): none when absent, the live ones alone. */
  primitiveNodes?: number
  records?: number
  keys?: number
  /** The groups of content keys and the parent edges between them past the live ones
   *  (`createContentKeys`). */
  groups?: number
  edges?: number
  /** A growth's room: past what the roots hold, as many primitive nodes, records and keys again
   *  (`grownLength`), at least `AHEAD_MIN` more, for the primitives and sources the growths after
   *  it bring — each doubling of them packs the roots again, O(log) times in all. The absolute
   *  counts above add to it. */
  ahead?: boolean
}

/** The least primitive nodes, records and keys a growth's room (`DagCapacity.ahead`) keeps past the
 *  live ones: a few primitives joining a large world pack nothing again. */
const AHEAD_MIN = 64
export const roomAhead = (held: number) => Math.max(grownLength(held, held + 1), held + AHEAD_MIN)

/** The live counts of `roots` — pages, queue entries (a placement's node each), and nodes, each
 *  primitive's once —, their levels summed level by level: pass `L`'s queue only holds entries of
 *  level `L`, so this total upper-bounds it, and the pass launches flat. Placement `w`'s levels lie
 *  `shift(w)` below the placement tree's (`placementTree.ts`). */
function countRoots(
  roots: readonly DagRoot[],
  shared: PackShared,
  shift: (w: number) => number = () => 0,
) {
  let pages = 0,
    entries = 0,
    nodes = 0
  const levels: number[] = [],
    seen = new Set<Float64Array>()
  roots.forEach((root, w) => {
    const culling = cullingOf(root),
      sizes = levelSizesOf(culling, shared),
      below = shift(w),
      count = culling.nodes.length / culling.stride
    pages += root.pages.length
    entries += count
    if (!seen.has(culling.nodes)) nodes += count
    seen.add(culling.nodes)
    for (let level = 0; level < sizes.length; level++)
      levels[level + below] = (levels[level + below] ?? 0) + sizes[level]
  })
  return { pages, entries, nodes, levels }
}

/** The pages, queue entries (`nodes`) and placements `roots` fill: what a growth's capacity starts
 *  from. */
export function dagRootCounts(roots: readonly DagRoot[]): DagCapacity {
  const { pages, entries } = countRoots(roots, emptyShared())
  return { pages, nodes: entries, worlds: roots.length }
}

/**
 * What a packing of `roots` at `capacity` holds before any is written: its live counts, the
 * placement tree over every placement but the world DAG's — wherever it sits, which starts its own
 * descent —, laid out for the capacity's placements, and its levels: a member's lie below the
 * tree's. The world DAG's rank is named (`PackedWorld.root`), so a packing that holds it keeps
 * room as any other, its links laid out for every placement the room takes.
 */
export function packPlan(roots: readonly DagRoot[], shared: PackShared, capacity?: DagCapacity) {
  const world = roots.findIndex((root) => root.origins),
    room = capacity,
    worlds = Math.max(roots.length, room?.worlds ?? 0),
    members = worlds - (world >= 0 ? 1 : 0)
  // The tree's nodes follow the primitives' shared ones: an append adds none of either.
  const first = countRoots(roots, shared)
  const primitiveNodes = Math.max(
    first.nodes,
    room?.primitiveNodes ?? 0,
    room?.ahead ? roomAhead(first.nodes) : 0,
  )
  const tree = placementTreeShape(roots, world, { members, worlds }, primitiveNodes)
  const shift = tree?.depth ?? 0
  const counted = shift ? countRoots(roots, shared, (w) => (w === world ? 0 : shift)) : first
  tree?.levels.forEach(({ count }, l) => (counted.levels[l] = (counted.levels[l] ?? 0) + count))
  const treeNodes = treeNodeCount(tree),
    nodes = primitiveNodes + treeNodes
  // Every placement's entry for each of its nodes — the room's included —, one at least for each
  // placement's root slot (`dagPrepare`), then the tree's.
  const entries = Math.max(first.entries, room?.nodes ?? 0, worlds) + treeNodes
  return { ...counted, nodes, primitiveNodes, entries, tree, world, room, worlds }
}
