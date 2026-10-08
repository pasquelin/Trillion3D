/**
 * THE PLACEMENT TREE KEPT TO THE POSES IT BOUNDS: a selection's tree (`placementTree.ts`)
 * fitted again where a change lands, and only there, once before the next cut is encoded — a
 * placement parked or taken back, marked past what a box holds or posed by a call that names it
 * (`placementMoved`), refits its group and the nodes above; a host walk, which names no placement,
 * refits every box once, as the worlds it moves are sent whole. Each refit writes back
 * the tree nodes it changed, never the placements' own nodes, before the cut reads the tree again. A pose the GPU
 * composes (`../../placement/gpuCompose.ts`) is not one the host holds: the group of a root composed
 * so is open while it is, and no other (`composedPlacement`).
 */
import type { GpuSelection } from '../core/selection.ts'
import { fitPlacementTree, opensTree, refitPlacementTree, treeNodeCount } from './placementTree.ts'
import { DAG_NODE_FLOATS, type PackedDag } from './types.ts'
import { writeRanges, type DagParts } from './split.ts'

/** The tree nodes an upload names, ascending, kept from one upload to the next. */
let sorted = new Int32Array(64)

/** Writes the tree nodes `nodes` names, ascending, in the cut's one run writer's ranges. */
function uploadNodes(
  device: GPUDevice,
  nodeParts: DagParts,
  packed: PackedDag,
  nodes: readonly number[],
) {
  if (sorted.length < nodes.length)
    sorted = new Int32Array(Math.max(nodes.length, sorted.length * 2))
  for (let i = 0; i < nodes.length; i++) sorted[i] = nodes[i]
  const source = { data: packed.nodes, sourceBase: 0, targetBase: 0, stride: DAG_NODE_FLOATS }
  writeRanges(device, nodeParts, sorted, nodes.length, source)
}

/** `selection`, its tree followed on `nodeParts` from now on, the groups of the placements
 *  `composed` names open; as it is without a tree. */
export function followPlacementTree(
  selection: GpuSelection,
  resources: { device: GPUDevice; packed: PackedDag; nodeParts: DagParts },
  composed?: (w: number) => boolean,
) {
  const { device, packed, nodeParts } = resources,
    tree = packed.placementTree
  if (!tree) return selection
  const upload = (nodes: readonly number[]) => uploadNodes(device, nodeParts, packed, nodes)
  const all = Array.from({ length: treeNodeCount(tree) }, (_, k) => tree.cellBase + k)
  // What moved since the tree was last read: refitted once, before the next cut reads it.
  const dirty = new Set<number>()
  // The tree was fitted as it was packed: the roots composed since are read at its first cut.
  let whole = !!composed
  if (composed) tree.composed = composed
  const refit = () => {
    if (whole) {
      fitPlacementTree(packed, tree)
      upload(all)
    } else if (dirty.size) upload(refitPlacementTree(packed, tree, dirty))
    whole = false
    dirty.clear()
  }
  const { dispatch, parkWorld, markWorld, updateWorlds } = selection
  selection.dispatch = (uniforms, shared) => {
    refit()
    return dispatch(uniforms, shared)
  }
  selection.parkWorld = (w, parked) => {
    parkWorld(w, parked)
    dirty.add(w)
  }
  selection.markWorld = (w, mark) => {
    const opened = opensTree(packed.mark[w])
    markWorld(w, mark)
    if (opensTree(packed.mark[w]) !== opened) dirty.add(w)
  }
  // A pose a call named fits its group again; a host walk, which names none, fits every box.
  selection.placementMoved = (w) => void dirty.add(w)
  selection.updateWorlds = (worlds, named) => {
    const moved = updateWorlds(worlds, named)
    if (moved && !named) whole = true
    return moved
  }
  // A root a parent composes on the GPU holds a pose the CPU does not: its group opens, and only
  // its own, from its link to its unlink, as the compose state says (`composed`,
  // `../../placement/gpuCompose.ts`).
  const { composedPlacement } = selection
  selection.composedPlacement = (w, linked) => {
    composedPlacement?.(w, linked)
    if (w < tree.slot.length) dirty.add(w)
  }
  return selection
}
