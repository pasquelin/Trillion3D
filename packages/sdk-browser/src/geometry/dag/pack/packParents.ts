import type { RootParent } from '../../selection/types.ts'
import { DAG_NODE_FLOATS, type PackedDag } from '../types.ts'
import { NODE_KIND, NODE_PARENT, PARENT_ERROR, PARENT_SPHERE } from '../nodeLayout.ts'

/**
 * THE GROUP ABOVE AN INSTANCE'S ROOT, IN THE NODE TABLE (`../nodeLayout.ts`, `NODE_PARENT`).
 *
 * An instance of an assembly names the error and the LOD ball of the group that replaces its root
 * (`DagRoot.rootParent`), and every placement of the assembly names the same ones for the same
 * instance. They are not words of each placement's frame row — twenty bytes a placement, assembly
 * or not —: the row holds one word, the node that holds them (`PARENT_WORD`), and every placement
 * that reads the same group reads the same node, one a distinct group. Such a node is no
 * hierarchy's: its error ceiling and its LOD ball are the group's, its kind says so, and no
 * descent reaches it. It lies among the primitives' nodes (`PackedDag.primitiveNodeCount`), behind
 * the live ones, where a packing or a placement appended in place writes it.
 */

/** The key of a group: its error and ball as the node holds them, single precision. */
const parentKey = (parent: RootParent) =>
  [parent.error, ...parent.sphere].map(Math.fround).join(',')

/** Whether a cut over `packed` can name the group above an instance's root: not when the leaves of
 *  its placement tree are narrow — its packing named none, so no leaf holds a ball for the refit to
 *  fit (`leafStride`, `PackedDag.parentNode`). The instances that would name one are packed again,
 *  wide, rather than appended or seated in place. A packing with no tree has no leaves. */
export const takesParents = (packed: Pick<PackedDag, 'placementTree' | 'parentNode'>) =>
  !packed.placementTree || !!packed.parentNode

/** The distinct groups `roots` name that no node holds yet (`held`, `PackedDag.parentNodes`): the
 *  nodes a packing of them writes besides their primitives'. */
export function newParents(
  roots: Iterable<{ rootParent?: RootParent }>,
  held: ReadonlyMap<string, number>,
) {
  const fresh = new Set<string>()
  for (const { rootParent } of roots) {
    const key = rootParent && parentKey(rootParent)
    if (key !== undefined && !held.has(key)) fresh.add(key)
  }
  return fresh.size
}

/** Node `node` of `nodes` written as the node of `parent`: its error and its ball the group's, no
 *  other word set. */
function writeParentNode(nodes: Float32Array, node: number, parent: RootParent) {
  const at = node * DAG_NODE_FLOATS
  nodes.fill(0, at, at + DAG_NODE_FLOATS)
  nodes[at + PARENT_ERROR] = parent.error
  for (let k = 0; k < 4; k++) nodes[at + PARENT_SPHERE + k] = parent.sphere[k]
  new Uint32Array(nodes.buffer, nodes.byteOffset, nodes.length)[at + NODE_KIND] = NODE_PARENT
}

/** The tables a node of a group is placed in. */
type ParentTables = {
  nodes: Float32Array
  live: { nodes: number }
  parentNodes: Map<string, number>
}

/** The node holding `parent`, written behind the live ones when no placement read it before: its
 *  index; `undefined` when it is new and the table holds no node for it. */
export function placeParentNode(p: ParentTables, parent: RootParent) {
  const key = parentKey(parent),
    known = p.parentNodes.get(key)
  if (known !== undefined) return known
  const node = p.live.nodes
  if ((node + 1) * DAG_NODE_FLOATS > p.nodes.length) return undefined
  writeParentNode(p.nodes, node, parent)
  p.live.nodes = node + 1
  p.parentNodes.set(key, node)
  return node
}
