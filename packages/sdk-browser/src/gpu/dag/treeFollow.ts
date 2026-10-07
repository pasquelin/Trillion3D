/**
 * THE PLACEMENT TREE KEPT TO THE POSES IT BOUNDS: a selection's tree (`placementTree.ts`)
 * fitted again where a change lands, and only there, once before the next cut is encoded — a
 * placement parked or taken back, marked past what a box holds or posed by a call that names it
 * (`placementMoved`), refits its group and the nodes above; a host walk, which names no placement,
 * refits every box once, as the worlds it moves are sent whole. Each refit writes back
 * the tree nodes it changed, never the placements' own nodes, before the tree is read again: by the
 * CPU, for the placements a view may hold (`visiblePlacements`), or by the cut. A pose the GPU
 * composes (`../../placement/gpuCompose.ts`) is not one the host holds: the group of a root composed
 * so is open while it is, and no other (`composedPlacement`).
 */
import type { GpuSelection } from '../core/selection.ts'
import {
  fitPlacementTree,
  opensTree,
  refitPlacementTree,
  treeNodeCount,
  visitPlacements,
} from './placementTree.ts'
import { DAG_NODE_FLOATS, type PackedDag } from './types.ts'
import { writeParts, type DagParts } from './split.ts'

/** Bytes of one node in the packed table. */
const NODE_BYTES = DAG_NODE_FLOATS * 4

/** Writes the nodes `nodes` names, ascending, one write per contiguous run. */
function uploadNodes(
  device: GPUDevice,
  nodeParts: DagParts,
  packed: PackedDag,
  nodes: readonly number[],
) {
  for (let k = 0; k < nodes.length;) {
    let end = k + 1
    while (end < nodes.length && nodes[end] === nodes[end - 1] + 1) end++
    const from = nodes[k] * NODE_BYTES
    writeParts(
      device,
      nodeParts,
      from,
      packed.nodes.buffer as ArrayBuffer,
      packed.nodes.byteOffset + from,
      (end - k) * NODE_BYTES,
    )
    k = end
  }
}

/** `selection`, its tree followed on `nodeParts` from now on; as it is without a tree. */
export function followPlacementTree(
  selection: GpuSelection,
  resources: { device: GPUDevice; packed: PackedDag; nodeParts: DagParts },
) {
  const { device, packed, nodeParts } = resources,
    tree = packed.placementTree
  if (!tree) return selection
  const upload = (nodes: readonly number[]) => uploadNodes(device, nodeParts, packed, nodes)
  const all = Array.from({ length: treeNodeCount(tree) }, (_, k) => tree.cellBase + k)
  // What moved since the tree was last read: refitted once, before whoever reads it next — the
  // CPU's plan of the image (`visiblePlacements`) or the cut.
  const dirty = new Set<number>()
  let whole = false
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
  selection.updateWorlds = (worlds, posesMoved = true, walked = true) => {
    const moved = updateWorlds(worlds, posesMoved, walked)
    if (moved && posesMoved && walked) whole = true
    return moved
  }
  selection.visiblePlacements = (planes, visit) => {
    refit()
    visitPlacements(packed, tree, planes, visit)
  }
  // A root a parent composes on the GPU holds a pose the CPU does not: its group opens, and only
  // its own, from its link to its unlink (`../../placement/gpuCompose.ts`).
  selection.composedPlacement = (w, composed) => {
    if (w >= tree.open.length || tree.open[w] === (composed ? 1 : 0)) return
    tree.open[w] = composed ? 1 : 0
    dirty.add(w)
  }
  return selection
}
