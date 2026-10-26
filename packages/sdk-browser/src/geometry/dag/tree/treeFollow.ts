/**
 * THE PLACEMENT TREE KEPT TO THE POSES IT BOUNDS: a selection's tree (`../placement/placementTree.ts`) fitted
 * again where a change lands, and only there, once before the next cut is encoded — a placement
 * parked or taken back, marked past what a box holds, one whose pose a send moved (`updateWorlds`,
 * a call's or a host walk's alike), one a parent composes on the GPU
 * (`../../../placement/compose/gpuCompose.ts`) whose parent moved, or one appended. The refit is the GPU's, the
 * engine's one (`treeRefit.ts`), and so are the leaves it fits over (`TreeLeaves`): this module
 * names the placements whose leaves are written and the groups to fit, and holds no box.
 */
import { NO_INDEX } from '../../../../../math/src/constants.ts'
import { drawnAlways, treeMarkMoved, TREE_SPAN } from '../placement/placementTree.ts'
import { type PackedDag } from '../types.ts'
import { mirrorKey } from '../../cut/adoption/denseKeys.ts'
import { createChangedRuns } from '../../residency/ranges.ts'
import { createTreeRefit } from './treeRefit.ts'
import { resized } from '../../../../../math/src/sequence/resized.ts'
import type { TreeTable } from './treeTable.ts'

/** The one writer of the tree's leaves (`../../../placement/tree/treeLeaves.ts`): each placement's root
 *  node box, grown by its reach, carried by the world the GPU holds of it. `encode` writes into
 *  `members` the leaves of the `count` placements `ranks` names — every placement's when `whole` —
 *  and of every root a parent composes; nothing is written, and nothing fits, until it is `ready`:
 *  every world it reads on the GPU. A leaf holds the ball of the group above its root only where
 *  the cut's packing named some (`parented`, `leafStride`). */
export type TreeLeaves = {
  /** Whether it can write: the worlds on the GPU and the leaves kernel of that width compiled
   *  (asked now where not). */
  ready(parented: boolean): boolean
  encode(
    encoder: GPUCommandEncoder,
    tables: {
      members: GPUBuffer
      nodes: GPUTextureView
      frames: GPUTextureView
      parented: boolean
    },
    named: { ranks: Int32Array<ArrayBuffer>; count: number; whole: boolean },
  ): void
}

type Tree = NonNullable<PackedDag['placementTree']>

/** What a sync fits: the tree and its refit, the writer of leaves, the tables the leaves read,
 *  what moved since the tree was last read, each placement once, the groups a composition moved
 *  (fitted once, before the next cut reads the tree; the first cut fits every group: the tree
 *  packs open (`packPlacementTree`), the refit is the one fit there is), the placements whose leaf
 *  is written, ascending — one scratch for every sync — and whether the first fit writes every
 *  leaf. */
type Fit = {
  device: GPUDevice
  tree: Tree
  refit: ReturnType<typeof createTreeRefit>
  leaves: TreeLeaves | undefined
  nodes: GPUTextureView
  frames: GPUTextureView
  dirty: ReturnType<typeof createChangedRuns>
  groups: Set<number>
  written: Int32Array<ArrayBuffer>
  whole: boolean
}

/** What moved fitted again, its leaves written first, in a command buffer of its own. */
function fitMoved(f: Fit) {
  const { tree, groups } = f
  const placements = f.dirty.count ? f.dirty.take() : undefined
  if (!placements?.length && !groups.size) return
  const fit = new Set(groups)
  groups.clear()
  let count = 0
  if (placements) f.written = resized(f.written, placements.length)
  for (const w of placements ?? []) {
    if (tree.slot[w] === NO_INDEX) continue
    fit.add(Math.floor(tree.slot[w] / TREE_SPAN))
    f.written[count++] = w
  }
  const encoder = f.device.createCommandEncoder({ label: 'Trillion3D placement tree refit' })
  f.leaves!.encode(
    encoder,
    { members: f.refit.members, nodes: f.nodes, frames: f.frames, parented: f.refit.parented },
    { ranks: f.written, count, whole: f.whole },
  )
  f.whole = false
  f.refit.run(encoder, fit)
  f.device.queue.submit([encoder.finish()])
}

/** Placement `w`'s group fits again at the next cut: parked or taken back, posed by a send,
 *  appended, or composed on the GPU by a parent from now on or no longer. */
function touchPlacement(f: Fit, w: number) {
  if (w < f.tree.slot.length) f.dirty.mark(w)
}

/** Placement `w`, whose mark is now `mark`, moved from `before`. */
function markPlacement(f: Fit, mark: number, w: number, before: number) {
  const { tree } = f
  if (!treeMarkMoved(before, mark)) return
  touchPlacement(f, w)
  if (w < tree.slot.length && tree.slot[w] !== NO_INDEX)
    mirrorKey(tree.always, w, drawnAlways(mark))
}

/** The member group of placement `w`, none outside the tree. */
function groupOfPlacement(tree: Tree, w: number) {
  const slot = w < tree.slot.length ? tree.slot[w] : NO_INDEX
  return slot === NO_INDEX ? -1 : Math.floor(slot / TREE_SPAN)
}

/** The follower of `packed`'s tree on `resources`; none without a tree. A member of the run
 *  (`../runtime/runtime.ts`): its operations tell it what moved, and every cut fits the tree again first
 *  (`sync`). */
export function createTreeFollower(
  resources: {
    device: GPUDevice
    packed: PackedDag
    cutTables: { nodes: { view: GPUTextureView } }
    treeTable: TreeTable
    frames: { rows: { view: GPUTextureView } }
  },
  leaves?: TreeLeaves,
) {
  const { device, packed, treeTable } = resources,
    tree = packed.placementTree,
    frames = resources.frames.rows.view
  if (!tree) return undefined
  const refit = createTreeRefit(device, packed, tree, { tree: treeTable.view, frames })
  const fitting: Fit = {
    device,
    tree,
    refit,
    leaves,
    nodes: resources.cutTables.nodes.view,
    frames,
    dirty: createChangedRuns(),
    groups: new Set<number>(Array.from({ length: tree.levels.at(-1)!.count }, (_, g) => g)),
    written: new Int32Array(8),
    whole: true,
  }
  const touch = (w: number) => touchPlacement(fitting, w)
  return {
    /** Whether the leaves hold the balls of the groups above instances' roots (`leafStride`). */
    parented: refit.parented,
    touch,
    /** Placement `w`'s mark moved from `before`: its leaf fits again where its reach moved, and it
     *  joins or leaves the members drawn whatever the view (`drawnAlways`). */
    marked: (w: number, before: number) => markPlacement(fitting, packed.mark[w], w, before),
    /** The poses a send moved (`updateWorlds`), a host walk's as a call's. */
    moved(ranks: ArrayLike<number>) {
      for (let k = 0; k < ranks.length; k++) touch(ranks[k])
    },
    /** The member group of placement `w`, none outside the tree: what a composition names the
     *  groups of the roots a parent moves by. */
    groupOf: (w: number) => groupOfPlacement(tree, w),
    /** The groups `named` fit again: those of the roots a parent composed, which moved with it. */
    groupsMoved(named: ArrayLike<number>) {
      for (let k = 0; k < named.length; k++) fitting.groups.add(named[k])
    },
    /** Before every cut on the tables, the main view's or one aside: what moved fitted again, its
     *  leaves written first, in a command buffer of its own that the cut's follows. Without a
     *  writer of leaves, or before the worlds they read are on the GPU, nothing fits: the nodes
     *  keep the boxes they hold — the whole world before the first fit, which no plane rejects. */
    sync() {
      // The members drawn whatever the view, their places moved since sent.
      treeTable.writeAlways()
      // Both kernels asked, then both needed: a fit that takes what moved runs its two steps.
      if (leaves) {
        const written = leaves.ready(refit.parented)
        if (refit.ready() && written) fitMoved(fitting)
      }
    },
    dispose: refit.dispose,
  }
}

export type TreeFollower = NonNullable<ReturnType<typeof createTreeFollower>>
