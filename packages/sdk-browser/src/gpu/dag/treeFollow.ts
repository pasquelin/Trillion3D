/**
 * THE PLACEMENT TREE KEPT TO THE POSES IT BOUNDS: a selection's tree (`placementTree.ts`)
 * fitted again where a change lands, and only there, once before the next cut is encoded — a
 * placement parked or taken back, or marked past what a box holds, refits its group and its cell;
 * poses moved refit every box once, as the worlds they move are sent whole. Each refit writes back
 * the tree nodes it changed, never the placements' own nodes. The CPU reads the same tree for the
 * placements a view may hold (`visiblePlacements`). A pose the GPU composes (`../../placement/gpuCompose.ts`) is not one the
 * host holds: the first opens every group for the session, so no box the CPU fitted rejects it.
 */
import type { GpuSelection } from '../core/selection.ts'
import {
  fitPlacementTree,
  opensTree,
  refitPlacementTree,
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
  const all = Array.from({ length: tree.cells + tree.groups }, (_, k) => tree.cellBase + k)
  // What moved since the last cut: refitted once, as the next one is encoded.
  const dirty = new Set<number>()
  let whole = false
  const { dispatch, parkWorld, markWorld, updateWorlds, worldsMovedOnGpu } = selection
  selection.dispatch = (uniforms, shared) => {
    if (whole) {
      fitPlacementTree(packed, tree)
      upload(all)
    } else if (dirty.size) upload(refitPlacementTree(packed, tree, dirty).sort((a, b) => a - b))
    whole = false
    dirty.clear()
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
  selection.updateWorlds = (worlds, posesMoved = true, translationsOnly = false) => {
    const moved = updateWorlds(worlds, posesMoved, translationsOnly)
    if (moved && posesMoved && !translationsOnly) whole = true
    return moved
  }
  selection.visiblePlacements = (planes, visit) => visitPlacements(packed, tree, planes, visit)
  selection.worldsMovedOnGpu = () => {
    worldsMovedOnGpu()
    if (!tree.open.includes(0)) return
    tree.open.fill(1)
    whole = true
  }
  return selection
}
