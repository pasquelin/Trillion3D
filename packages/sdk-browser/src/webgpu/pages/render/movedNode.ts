import type { ClusterRoot } from '../../../page/selection/types.ts'
import { rootSource } from '../../../placement/hidden.ts'
import type { PageRec } from '../../../page/selection/selection.ts'
import { Object3D } from '../../../../../sdk-core/src/world/object/object3d.ts'
import {
  NODE_ALIVE,
  type TransformTree,
} from '../../../../../sdk-core/src/world/transform-tree/transformTree.ts'
import { nextInSubtree } from '../../../../../sdk-core/src/world/transform-tree/links.ts'

type Roots = readonly ClusterRoot<PageRec>[]

/** The entries of one list by their source node's slot in `tree`: the node and the entries' ranks,
 *  taken at the list's length and at its sources' revision. */
type BySlot = {
  tree: TransformTree
  length: number
  revision: number
  slots: Map<number, { node: Object3D; ranks: number[] }>
}

/** A list's index by node, held by the list's owner (the layout's roots, the blend state's draws):
 *  built at its first read, again when the list grew in place or its sources moved — `revision`,
 *  raised when a row is re-seated on another mesh (`../../../placement/update.ts`). */
export type NodeIndex = { revision: number; held?: BySlot }

function bySlot<E>(
  entries: readonly E[],
  sourceOf: (entry: E) => Object3D | undefined,
  tree: TransformTree,
  index: NodeIndex,
) {
  const { held, revision } = index
  if (held?.tree === tree && held.length === entries.length && held.revision === revision)
    return held.slots
  const slots: BySlot['slots'] = new Map()
  for (let i = 0; i < entries.length; i++) {
    const node = sourceOf(entries[i])
    if (!node || Object3D._treeOf(node) !== tree) continue
    const at = slots.get(node.index)
    if (at?.node === node) at.ranks.push(i)
    else slots.set(node.index, { node, ranks: [i] })
  }
  index.held = { tree, length: entries.length, revision, slots }
  return slots
}

/**
 * The entries of `entries` whose source node (`sourceOf`) lies in the subtree of `node`, read in
 * its slot of the page's tree — each once, in the walk's order —, written into `out` from
 * `at` on; returns where they end. A slot freed since, or whose node was destroyed and its slot
 * taken by another, holds none of the old node's entries. `out` is never truncated: it keeps its
 * storage and grows only past its length. `index` is the list's index by node, its owner's.
 */
export function appendUnder<E>(
  entries: readonly E[],
  sourceOf: (entry: E) => Object3D | undefined,
  node: Object3D,
  out: number[],
  at: number,
  index: NodeIndex,
) {
  const tree = Object3D._treeOf(node),
    slot = node.index
  if (!(tree.flags[slot] & NODE_ALIVE)) return at
  const slots = bySlot(entries, sourceOf, tree, index)
  let count = at
  for (let j = slot; j >= 0; j = nextInSubtree(tree, j, slot)) {
    const held = slots.get(j)
    if (held?.node._alive) for (const i of held.ranks) out[count++] = i
  }
  return count
}

/** The roots a layout holds, and their index by node, made at its first read. */
export type RootsOwner = { readonly selectionRoots: Roots; rootIndex?: NodeIndex }

/** `appendUnder` over the selection roots of `layout`, by the node each draws (`rootSource`). */
export const appendRootsUnder = (layout: RootsOwner, node: Object3D, out: number[], at: number) =>
  appendUnder(
    layout.selectionRoots,
    rootSource,
    node,
    out,
    at,
    (layout.rootIndex ??= { revision: 0 }),
  )
