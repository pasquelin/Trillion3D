/**
 * THE PLACEMENT TREE KEPT TO THE POSES IT BOUNDS: a selection's tree (`placementTree.ts`) fitted
 * again where a change lands, and only there, once before the next cut is encoded — a placement
 * parked or taken back, marked past what a box holds, one whose pose a send moved (`updateWorlds`,
 * a call's or a host walk's alike), one a parent composes on the GPU
 * (`../../placement/gpuCompose.ts`) whose parent moved, or one appended. The refit is the GPU's, the
 * engine's one (`treeRefit.ts`): this module names what it fits and writes the leaves — the box of
 * each placement the CPU holds the world of — and the composition writes the ones it composes.
 */
import { opensTree, TREE_SPAN } from './placementTree.ts'
import { DAG_NODE_FLOATS, type PackedDag } from './types.ts'
import { writeRanges, type DagParts } from './split.ts'
import { createSortedKeys, takeSorted } from '../../webgpu/cut/denseKeys.ts'
import { createTreeRefit, type RefitTables } from './treeRefit.ts'
import { resized } from '../../../../math/src/sequence/resized.ts'

/** Writes the tree nodes `nodes` names, ascending, in the cut's one run writer's ranges: an
 *  append's (`../dag/runtimeOps.ts`). */
export function uploadNodes(
  device: GPUDevice,
  nodeParts: DagParts,
  packed: PackedDag,
  nodes: Int32Array,
) {
  const source = { data: packed.nodes, sourceBase: 0, targetBase: 0, stride: DAG_NODE_FLOATS }
  writeRanges(device, nodeParts, nodes, nodes.length, source)
}

/** The leaves a parent's composition writes: whether it holds placement `w`, and the pass that
 *  writes them all into `members`, the root boxes of `nodes` carried by the worlds it composes. */
export type ComposedLeaves = {
  has(w: number): boolean
  /** The layout of the nodes the tree is followed over: the pass is asked before a frame needs it. */
  lay(nodes: { per: number; parts: number }): void
  encode(encoder: GPUCommandEncoder, tables: { members: GPUBuffer; nodeParts: DagParts }): void
}

/** The follower of `packed`'s tree on `resources`; none without a tree. A member of the run
 *  (`runtime.ts`): its operations tell it what moved, and every cut fits the tree again first
 *  (`sync`). */
export function createTreeFollower(
  resources: {
    device: GPUDevice
    packed: PackedDag
    nodeParts: DagParts
    coldParts: DagParts
    frames: RefitTables['frames']
  },
  leaves?: ComposedLeaves,
) {
  const { device, packed, nodeParts, coldParts, frames } = resources,
    tree = packed.placementTree
  if (!tree) return undefined
  const refit = createTreeRefit(device, packed, tree, { nodeParts, coldParts, frames })
  leaves?.lay({ per: nodeParts.bytes / (DAG_NODE_FLOATS * 4), parts: nodeParts.buffers.length })
  // What moved since the tree was last read, each placement once, and the groups a composition
  // moved: fitted once, before the next cut reads the tree.
  // The first cut fits every group: the tree packs open (`packPlacementTree`), the refit is the
  // one fit there is.
  const dirty = createSortedKeys(),
    groups = new Set<number>(
      tree.levels.at(-1)!.count
        ? Array.from({ length: tree.levels.at(-1)!.count }, (_, g) => g)
        : [],
    )
  // The moved placements whose leaf the CPU writes, ascending: one scratch for every sync.
  let written = new Int32Array(8)
  /** Placement `w`'s group fits again at the next cut: parked or taken back, posed by a send,
   *  appended, or composed on the GPU by a parent from now on or no longer. */
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
    /** The member group of placement `w`, none outside the tree: what a composition names the
     *  groups of the roots a parent moves by. */
    groupOf(w: number) {
      const slot = w < tree.slot.length ? tree.slot[w] : 0xffffffff
      return slot === 0xffffffff ? -1 : Math.floor(slot / TREE_SPAN)
    },
    /** The groups `named` fit again: those of the roots a parent composed, which moved with it. */
    groupsMoved(named: ArrayLike<number>) {
      for (let k = 0; k < named.length; k++) groups.add(named[k])
    },
    /** Before every cut on the tables, the main view's or one aside: what moved fitted again, in a
     *  command buffer of its own that the cut's follows. */
    sync() {
      const placements = dirty.listed.count ? takeSorted(dirty) : undefined
      if (!placements?.length && !groups.size) return
      const fit = new Set(groups)
      groups.clear()
      let count = 0
      if (placements) written = resized(written, placements.length)
      for (const w of placements ?? []) {
        if (tree.slot[w] === 0xffffffff) continue
        fit.add(Math.floor(tree.slot[w] / TREE_SPAN))
        if (!leaves?.has(w)) written[count++] = w
      }
      refit.leaves(written, count)
      const encoder = device.createCommandEncoder({ label: 'Trillion3D placement tree refit' })
      leaves?.encode(encoder, { members: refit.members, nodeParts })
      refit.run(encoder, fit)
      device.queue.submit([encoder.finish()])
    },
    dispose: refit.dispose,
  }
}

export type TreeFollower = NonNullable<ReturnType<typeof createTreeFollower>>
