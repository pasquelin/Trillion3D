import type { ClusterRoot } from '../../../page/selection/types.ts'
import type { PageRec } from '../../../page/selection/selection.ts'
import { Object3D } from '../../../../../sdk-core/src/world/object/object3d.ts'
import {
  NODE_ALIVE,
  type TransformTree,
} from '../../../../../sdk-core/src/world/transform-tree/transformTree.ts'
import { nextInSubtree } from '../../../../../sdk-core/src/world/transform-tree/links.ts'

type Roots = readonly ClusterRoot<PageRec>[]

/** Selection-root ranks by source mesh, built once per root list. */
const rootsByMeshOf = new WeakMap<Roots, Map<Object3D, number[]>>()

function rootsByMesh(roots: Roots) {
  let map = rootsByMeshOf.get(roots)
  if (map) return map
  map = new Map()
  for (let i = 0; i < roots.length; i++) {
    const mesh = roots[i].pages[0]?.sourceMesh as Object3D | undefined
    if (!mesh) continue
    const list = map.get(mesh)
    if (list) list.push(i)
    else map.set(mesh, [i])
  }
  rootsByMeshOf.set(roots, map)
  return map
}

/**
 * Ranks of the roots whose source mesh is `node` or lies below it, each once, in the walk's order,
 * written into `out` from `at` on; returns where they end. The node's LIVE subtree is walked once:
 * the same relation as climbing each root's parent chain up to the node. `out` is never
 * truncated: it keeps its storage and grows only past its length.
 */
export function appendRootsUnder(roots: Roots, node: Object3D, out: number[], at: number) {
  walking = rootsByMesh(roots)
  found = out
  count = at
  node.traverse(collect)
  // Let go of the layout's meshes and the list: a released scene is not kept alive by the last move.
  walking = NONE
  found = EMPTY
  return count
}

// The walk's state and its one callback, declared once: a move allocates no closure.
const NONE = new Map<Object3D, number[]>(),
  EMPTY: number[] = []
let walking = NONE,
  found = EMPTY,
  count = 0
const collect = (walk: Object3D) => {
  const list = walking.get(walk)
  if (list) for (const i of list) found[count++] = i
}

/** Selection-root ranks by their source mesh's slot in `tree`, built once per root list and
 *  again when the list grew in place. */
const rootsBySlotOf = new WeakMap<
  Roots,
  { tree: TransformTree; length: number; slots: Map<number, number[]> }
>()

function rootsBySlot(roots: Roots, tree: TransformTree) {
  const held = rootsBySlotOf.get(roots)
  if (held?.tree === tree && held.length === roots.length) return held.slots
  const slots = new Map<number, number[]>()
  for (let i = 0; i < roots.length; i++) {
    const mesh = roots[i].pages[0]?.sourceMesh as Object3D | undefined
    if (!mesh || Object3D._treeOf(mesh) !== tree) continue
    const list = slots.get(mesh.index)
    if (list) list.push(i)
    else slots.set(mesh.index, [i])
  }
  rootsBySlotOf.set(roots, { tree, length: roots.length, slots })
  return slots
}

/**
 * `appendRootsUnder` for the node at `slot` of `tree`, read in the tree itself: the roots whose
 * source mesh lies in the slot's subtree, each once, written into `out` from `at` on; returns
 * where they end. A slot freed since it was listed holds none.
 */
export function appendRootsUnderSlot(
  roots: Roots,
  tree: TransformTree,
  slot: number,
  out: number[],
  at: number,
) {
  if (!(tree.flags[slot] & NODE_ALIVE)) return at
  const slots = rootsBySlot(roots, tree)
  let count = at
  for (let j = slot; j >= 0; j = nextInSubtree(tree, j, slot)) {
    const list = slots.get(j)
    if (list) for (const i of list) out[count++] = i
  }
  return count
}
