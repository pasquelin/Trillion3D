import type { ClusterRoot } from '../../../page/selection/types.ts'
import type { PageRec } from '../../../page/selection/selection.ts'
import { Object3D } from '../../../../../sdk-core/src/world/object/object3d.ts'
import {
  NODE_ALIVE,
  type TransformTree,
} from '../../../../../sdk-core/src/world/transform-tree/transformTree.ts'
import { nextInSubtree } from '../../../../../sdk-core/src/world/transform-tree/links.ts'

type Roots = readonly ClusterRoot<PageRec>[]

/** The entries of one list by their source node's slot in `tree`: the node and the entries' ranks.
 *  Built once per list and again when it grew in place. */
type BySlot = {
  tree: TransformTree
  length: number
  slots: Map<number, { node: Object3D; ranks: number[] }>
}
const bySlotOf = new WeakMap<readonly unknown[], BySlot>()

function bySlot<E>(
  entries: readonly E[],
  sourceOf: (entry: E) => Object3D | undefined,
  tree: TransformTree,
) {
  const held = bySlotOf.get(entries)
  if (held?.tree === tree && held.length === entries.length) return held.slots
  const slots: BySlot['slots'] = new Map()
  for (let i = 0; i < entries.length; i++) {
    const node = sourceOf(entries[i])
    if (!node || Object3D._treeOf(node) !== tree) continue
    const at = slots.get(node.index)
    if (at?.node === node) at.ranks.push(i)
    else slots.set(node.index, { node, ranks: [i] })
  }
  bySlotOf.set(entries, { tree, length: entries.length, slots })
  return slots
}

/**
 * The entries of `entries` whose source node (`sourceOf`) lies in the subtree of the node at `slot`
 * of `tree`, read in the tree itself — each once, in the walk's order —, written into `out` from
 * `at` on; returns where they end. A slot freed since, or whose node was destroyed and its slot
 * taken by another, holds none of the old node's entries. `out` is never truncated: it keeps its
 * storage and grows only past its length.
 */
export function appendUnderSlot<E>(
  entries: readonly E[],
  sourceOf: (entry: E) => Object3D | undefined,
  tree: TransformTree,
  slot: number,
  out: number[],
  at: number,
) {
  if (!(tree.flags[slot] & NODE_ALIVE)) return at
  const slots = bySlot(entries, sourceOf, tree)
  let count = at
  for (let j = slot; j >= 0; j = nextInSubtree(tree, j, slot)) {
    const held = slots.get(j)
    if (held?.node._alive) for (const i of held.ranks) out[count++] = i
  }
  return count
}

/** The source node of a root: its first page's mesh. */
export const rootSource = (root: ClusterRoot<PageRec>) =>
  root.pages[0]?.sourceMesh as Object3D | undefined

/** `appendUnderSlot` over the selection roots. */
export const appendRootsUnderSlot = (
  roots: Roots,
  tree: TransformTree,
  slot: number,
  out: number[],
  at: number,
) => appendUnderSlot(roots, rootSource, tree, slot, out, at)
