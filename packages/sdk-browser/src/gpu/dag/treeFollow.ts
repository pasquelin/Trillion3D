/**
 * THE PLACEMENT TREE KEPT TO THE POSES IT BOUNDS: a selection's tree (`placementTree.ts`)
 * fitted again where a change lands, and only there, once before the next cut is encoded — a
 * placement parked or taken back, marked past what a box holds or whose pose a send moved
 * (`updateWorlds`, a call's or a host walk's alike), refits its group and the nodes above. Each
 * refit writes back the tree nodes it changed, never the placements' own nodes, before the cut
 * reads the tree again. A pose the GPU composes (`../../placement/gpuCompose.ts`) is not one the
 * host holds: the group of a root composed so is open while it is, and no other
 * (`composedPlacement`).
 */
import { fitPlacementTree, opensTree, refitPlacementTree, treeNodeCount } from './placementTree.ts'
import { DAG_NODE_FLOATS, type PackedDag } from './types.ts'
import { writeRanges, type DagParts } from './split.ts'
import { createSortedKeys, takeSorted } from '../../webgpu/cut/denseKeys.ts'

/** Writes the tree nodes `nodes` names, ascending, in the cut's one run writer's ranges: a refit's,
 *  an append's (`../dag/runtimeOps.ts`). */
export function uploadNodes(
  device: GPUDevice,
  nodeParts: DagParts,
  packed: PackedDag,
  nodes: Int32Array,
) {
  const source = { data: packed.nodes, sourceBase: 0, targetBase: 0, stride: DAG_NODE_FLOATS }
  writeRanges(device, nodeParts, nodes, nodes.length, source)
}

/** The follower of `packed`'s tree on `nodeParts`, the groups of the placements `composed` names
 *  open; none without a tree. A member of the run (`runtime.ts`): its operations tell it what
 *  moved, and every cut fits the tree again first (`sync`). */
export function createTreeFollower(
  resources: { device: GPUDevice; packed: PackedDag; nodeParts: DagParts },
  composed?: (w: number) => boolean,
) {
  const { device, packed, nodeParts } = resources,
    tree = packed.placementTree
  if (!tree) return undefined
  const upload = (nodes: Int32Array) => uploadNodes(device, nodeParts, packed, nodes)
  const all = Int32Array.from({ length: treeNodeCount(tree) }, (_, k) => tree.cellBase + k)
  // What moved since the tree was last read, each placement once: refitted once, before the next
  // cut reads it.
  const dirty = createSortedKeys()
  // The tree was fitted as it was packed: the roots composed since are read at its first cut.
  let whole = !!composed
  if (composed) tree.composed = composed
  /** Placement `w`'s group fits again at the next cut: parked or taken back, posed by a send, or
   *  composed on the GPU by a parent from now on or no longer — its group open while it is, and
   *  no other (`composed`, `../../placement/gpuCompose.ts`). */
  const touch = (w: number) => {
    if (w < tree.slot.length) dirty.listed.add(w)
  }
  return {
    touch,
    /** Placement `w`'s mark moved from `before`: its group fits again where it opens or closes. */
    marked(w: number, before: number) {
      if (opensTree(packed.mark[w]) !== opensTree(before)) touch(w)
    },
    /** The poses a send moved (`updateWorlds`), a host walk's as a call's. */
    moved(ranks: ArrayLike<number>) {
      for (let k = 0; k < ranks.length; k++) touch(ranks[k])
    },
    /** Before every cut on the tables, the main view's or one aside: what moved fitted again. */
    sync() {
      if (whole) {
        fitPlacementTree(packed, tree)
        upload(all)
      } else if (dirty.listed.count) upload(refitPlacementTree(packed, tree, takeSorted(dirty)))
      whole = false
      dirty.listed.clear()
    },
  }
}

export type TreeFollower = NonNullable<ReturnType<typeof createTreeFollower>>
