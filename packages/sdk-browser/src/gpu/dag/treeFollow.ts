/**
 * THE PLACEMENT TREE KEPT TO THE POSES IT BOUNDS: a selection's tree (`placementTree.ts`) fitted
 * again where a change lands, and only there, once before the next cut is encoded — a placement
 * parked or taken back, marked past what a box holds, one whose pose a send moved (`updateWorlds`,
 * a call's or a host walk's alike), one a parent composes on the GPU
 * (`../../placement/gpuCompose.ts`) whose parent moved, or one appended. The refit is the GPU's, the
 * engine's one (`treeRefit.ts`), and so are the leaves it fits over (`TreeLeaves`): this module
 * names the placements whose leaves are written and the groups to fit, and holds no box.
 */
import { drawnAlways, treeMarkMoved, TREE_SPAN } from './placementTree.ts'
import { type PackedDag } from './types.ts'
import type { DagParts } from './split.ts'
import { mirrorKey } from '../../webgpu/cut/denseKeys.ts'
import { createChangedRuns } from '../../webgpu/residency/ranges.ts'
import { createTreeRefit } from './treeRefit.ts'
import { resized } from '../../../../math/src/sequence/resized.ts'
import type { TreeTable } from './treeTable.ts'

/** The one writer of the tree's leaves (`../../placement/treeLeaves.ts`): each placement's root
 *  node box, grown by its reach, carried by the world the GPU holds of it. `encode` writes into
 *  `members` the leaves of the `count` placements `ranks` names — every placement's when `whole` —
 *  and of every root a parent composes; nothing is written, and nothing fits, until it is `ready`:
 *  every world it reads on the GPU. */
export type TreeLeaves = {
  ready(): boolean
  encode(
    encoder: GPUCommandEncoder,
    tables: { members: GPUBuffer; nodeParts: DagParts; frames: GPUTextureView },
    named: { ranks: Int32Array<ArrayBuffer>; count: number; whole: boolean },
  ): void
}

/** The follower of `packed`'s tree on `resources`; none without a tree. A member of the run
 *  (`runtime.ts`): its operations tell it what moved, and every cut fits the tree again first
 *  (`sync`). */
export function createTreeFollower(
  resources: {
    device: GPUDevice
    packed: PackedDag
    nodeParts: DagParts
    treeTable: TreeTable
    frames: { rows: { view: GPUTextureView } }
  },
  leaves?: TreeLeaves,
) {
  const { device, packed, nodeParts, treeTable } = resources,
    tree = packed.placementTree,
    frames = resources.frames.rows.view
  if (!tree) return undefined
  const refit = createTreeRefit(device, packed, tree, { tree: treeTable.view, frames })
  // What moved since the tree was last read, each placement once, and the groups a composition
  // moved: fitted once, before the next cut reads the tree.
  // The first cut fits every group: the tree packs open (`packPlacementTree`), the refit is the
  // one fit there is.
  const dirty = createChangedRuns(),
    groups = new Set<number>(
      tree.levels.at(-1)!.count
        ? Array.from({ length: tree.levels.at(-1)!.count }, (_, g) => g)
        : [],
    )
  // The placements whose leaf is written, ascending: one scratch for every sync. The first fit
  // writes every leaf.
  let written = new Int32Array(8),
    whole = true
  /** Placement `w`'s group fits again at the next cut: parked or taken back, posed by a send,
   *  appended, or composed on the GPU by a parent from now on or no longer. */
  const touch = (w: number) => {
    if (w < tree.slot.length) dirty.mark(w)
  }
  return {
    touch,
    /** Placement `w`'s mark moved from `before`: its leaf fits again where its reach moved, and it
     *  joins or leaves the members drawn whatever the view (`drawnAlways`). */
    marked(w: number, before: number) {
      const mark = packed.mark[w]
      if (!treeMarkMoved(before, mark)) return
      touch(w)
      if (w < tree.slot.length && tree.slot[w] !== 0xffffffff)
        mirrorKey(tree.always, w, drawnAlways(mark))
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
    /** Before every cut on the tables, the main view's or one aside: what moved fitted again, its
     *  leaves written first, in a command buffer of its own that the cut's follows. Without a
     *  writer of leaves, or before the worlds they read are on the GPU, nothing fits: the nodes
     *  keep the boxes they hold — the whole world before the first fit, which no plane rejects. */
    sync() {
      // The members drawn whatever the view, their places moved since sent.
      treeTable.writeAlways()
      if (!leaves?.ready()) return
      const placements = dirty.count ? dirty.take() : undefined
      if (!placements?.length && !groups.size) return
      const fit = new Set(groups)
      groups.clear()
      let count = 0
      if (placements) written = resized(written, placements.length)
      for (const w of placements ?? []) {
        if (tree.slot[w] === 0xffffffff) continue
        fit.add(Math.floor(tree.slot[w] / TREE_SPAN))
        written[count++] = w
      }
      const encoder = device.createCommandEncoder({ label: 'Trillion3D placement tree refit' })
      leaves.encode(
        encoder,
        { members: refit.members, nodeParts, frames },
        { ranks: written, count, whole },
      )
      whole = false
      refit.run(encoder, fit)
      device.queue.submit([encoder.finish()])
    },
    dispose: refit.dispose,
  }
}

export type TreeFollower = NonNullable<ReturnType<typeof createTreeFollower>>
