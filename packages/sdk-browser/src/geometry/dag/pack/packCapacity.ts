import { grownLength } from '../../../../../math/src/sequence/resized.ts'
import type { DagRoot } from '../types.ts'
import { placementTreeShape, treeNodeCount } from '../placement/placementTree.ts'
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
  /** Primitive nodes and records past the live ones, for the primitives a growth brings
   *  (`appendDagRoots`): none when absent, the live ones alone. */
  primitiveNodes?: number
  records?: number
  /** A growth's room: past what the roots hold, as many primitive nodes and records again
   *  (`grownLength`), at least `AHEAD_MIN` more, for the primitives and sources the growths after
   *  it bring — each doubling of them packs the roots again, O(log) times in all. The absolute
   *  counts above add to it. */
  ahead?: boolean
}

/** The least primitive nodes and records a growth's room (`DagCapacity.ahead`) keeps past the
 *  live ones: a few primitives joining a large world pack nothing again. */
const AHEAD_MIN = 64
const roomAhead = (held: number) => Math.max(grownLength(held, held + 1), held + AHEAD_MIN)

/** Slots a packing keeps for `held` live ones: the room's absolute count, and its growth's room
 *  past them when `room.ahead`, whichever is larger. */
export const roomFor = (held: number, absolute: number | undefined, room?: DagCapacity) =>
  Math.max(held, absolute ?? 0, room?.ahead ? roomAhead(held) : 0)

/** The live counts of `roots` — pages, queue entries (a placement's node each), and nodes, each
 *  primitive's once and none a packing already `holds` —, their levels summed level by level: pass
 *  `L`'s queue only holds entries of level `L`, so this total upper-bounds it, and the pass launches
 *  flat. Placement `w`'s levels lie `shift(w)` below the placement tree's (`../placement/placementTree.ts`). */
export function countRoots(
  roots: readonly DagRoot[],
  shared: PackShared,
  shift: (w: number) => number = () => 0,
  holds: (nodes: Float64Array) => boolean = () => false,
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
    if (!seen.has(culling.nodes) && !holds(culling.nodes)) nodes += count
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
 * placement tree over every placement but the world DAG's — wherever they sit, each starting its
 * own descent —, laid out for the capacity's placements, and its levels: a member's lie below the
 * tree's. The world DAG's ranks are named (`PackedWorld.roots`), so a packing that holds it keeps
 * room as any other, its links laid out for every placement the room takes.
 */
export function packPlan(roots: readonly DagRoot[], shared: PackShared, capacity?: DagCapacity) {
  const worldRoots = worldRanks(roots),
    isWorld = new Set(worldRoots),
    room = capacity,
    worlds = Math.max(roots.length, room?.worlds ?? 0),
    members = worlds - worldRoots.length
  // The tree's nodes follow the primitives' shared ones: an append adds none of either.
  const first = countRoots(roots, shared)
  const primitiveNodes = roomFor(first.nodes, room?.primitiveNodes, room)
  const tree = placementTreeShape(roots, isWorld, { members, worlds }, primitiveNodes)
  const shift = tree?.depth ?? 0
  const counted = shift ? countRoots(roots, shared, (w) => (isWorld.has(w) ? 0 : shift)) : first
  tree?.levels.forEach(({ count }, l) => (counted.levels[l] = (counted.levels[l] ?? 0) + count))
  const treeNodes = treeNodeCount(tree),
    nodes = primitiveNodes + treeNodes
  // Every placement's entry for each of its nodes — the room's included —, one at least for each
  // placement's root slot (`dagPrepare`), then the tree's.
  const entries = Math.max(first.entries, room?.nodes ?? 0, worlds) + treeNodes
  return { ...counted, nodes, primitiveNodes, entries, tree, worldRoots, room, worlds }
}

/** The ranks of `roots` that place the world DAG (an `hlod`), by the row each is placed by —
 *  instance `k` the root of row `k`, the placement of its model it draws (`placeInCell`). */
const worldRanks = (roots: readonly DagRoot[]) =>
  roots
    .flatMap((root, w) => (root.hlod ? [w] : []))
    .sort((a, b) => (roots[a].placement?.index ?? 0) - (roots[b].placement?.index ?? 0))
