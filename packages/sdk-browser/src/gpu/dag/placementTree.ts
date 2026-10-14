/**
 * THE PLACEMENT TREE: CELLS, THEN INSTANCE GROUPS, ABOVE EVERY PLACEMENT'S OWN HIERARCHY.
 *
 * The cut descends each placement's culling hierarchy level by level (`shader/levelWgsl.ts`); it
 * used to start from every placement's root, so a frame paid every placement of the world — its
 * planes brought into the placement's space, its matrices, its root's test — whether the view held
 * it or not. The tree puts two levels of the same `CullNode`s above them, in the same descent, no
 * second traversal: an instance GROUP bounds up to `TREE_SPAN` placements, a CELL up to `TREE_SPAN`
 * nodes of the level below. Its top level starts the descent; a kept group deposits its placements,
 * each read where the descent reaches it (`placementTreeWgsl.ts`), and a rejected one costs its
 * members nothing. Every placement but the world DAG's is a member, wherever it sits in the packing, and
 * the tree is laid out for the packing's capacity: the placements a growth appends in place fill
 * new groups in the order the full build gives them (`joinPlacementTree`). Its nodes, its order and
 * its list of members drawn whatever the view live in one record table of their own
 * (`treeTable.ts`), which every reader reads in place; a queue entry names a node of it past the
 * placements' own nodes (`cellBase` on).
 * A group's members are consecutive in the tree's ORDER: the rows' own when a partition fills them
 * (a cell takes consecutive rows, `../../partition/rows.ts`, and gives them back together), else
 * the placements on a Morton curve of their positions, so a group is a patch of the world whatever
 * order the scene lists its nodes in (`order`).
 *
 * A tree node's box is the WORLD box of its members — each root's box, grown in its own space by its
 * deformation's reach as its root test grows its planes (`primitiveWgsl.ts`), through its absolute
 * world —, tested against the frustum's render-frame planes once the eye is taken off it. It holds
 * every member's leaf, grown by a margin past the single-precision rounding of both tests, so a box
 * the tree rejects is one every member's root test would have rejected: the cut is unchanged. Every
 * box is finite: a member drawn whatever the view — never culled, or deformed past every finite
 * reach (`drawnAlways`) — is no group's to open; it is listed apart (`always`) and opened from
 * queue 0 with the tree's top (`placementTreeWgsl.ts`), its leaf kept in its group for what walks
 * the tree by boxes — a ray (`../../bounce/runtimeSceneWgsl.ts`).
 * A parked member, or a member slot no placement holds yet, holds nothing.
 *
 * The tree is laid out here — `packPlacementTree` writes every node open, as the tables are made —,
 * and fit on the GPU alone (`treeRefit.ts`): every node at the first cut, then what a pose, a park
 * or a mark moved, over the leaves the GPU writes from the worlds it holds
 * (`../../placement/treeLeaves.ts`), bottom up. The CPU holds no box of it.
 */
import { WORKGROUP_THREADS } from '../dispatch/grid.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { SPRITE_UNCULLED } from '../../visibility/shader/spriteWgsl.ts'
import { DAG_NODE_FLOATS } from './types.ts'
import { NO_INDEX } from '../../../../math/src/constants.ts'
import { createMirroredKeys, type MirroredKeys } from '../../webgpu/cut/denseKeys.ts'
import { placementOrder, type Ordered } from './placementOrder.ts'

/** Placements a group bounds, and nodes of the level below a cell bounds: one workgroup's lanes. */
export const TREE_SPAN = WORKGROUP_THREADS
/** A node's kind (`NODE_KIND`): a cell, whose children are nodes of the level below; a group, whose
 *  children are placements. Zero is a placement's own node. */
export const TREE_CELL = 1
export const TREE_GROUP = 2

/** One level of the tree: its first node, within the tree, and its node count. */
type TreeLevel = { base: number; count: number }

/**
 * The tree: its `levels`, top first, the last its groups, its `nodes` — twenty-four words each, laid
 * as a `CullNode`, indexed within the tree: a cell's children are too —, which a queue entry names
 * from `cellBase` on; `depth` the levels it sets above a member's root. `order[k]` is the placement
 * member `k` names (`NO_INDEX` past the `count` live members, up to `capacity` — a member slot a
 * growth left before its new groups names none), `slot[w]` the member placement `w` is (`NO_INDEX`
 * for the world DAG). Its table on the device holds them (`treeTable.ts`).
 */
export type PlacementTree = {
  capacity: number
  count: number
  cellBase: number
  depth: number
  levels: TreeLevel[]
  nodes: Float32Array
  order: Uint32Array
  slot: Uint32Array
  /** The members drawn whatever the view (`drawnAlways`): queue 0 opens them
   *  (`placementTreeWgsl.ts`). */
  always: MirroredKeys
}

/** Whether `members` member slots take a tree: not when one group would hold them all, a cell of
 *  one group saving the descent nothing. */
const groupsPlacements = (members: number) => members > TREE_SPAN

/** The levels of a tree of `capacity` members, top first: groups of `TREE_SPAN` members, cells of
 *  `TREE_SPAN` nodes of the level below, `ceil(log64 capacity)` levels in all, so its top is one
 *  node whatever the world: the descent opens on it alone — node 0 of the tree. */
function treeLevels(capacity: number) {
  let depth = 1
  for (let span = TREE_SPAN; span < capacity; span *= TREE_SPAN) depth++
  const counts = [ceilDiv(capacity, TREE_SPAN)]
  while (counts.length < depth) counts.unshift(ceilDiv(counts[0], TREE_SPAN))
  let base = 0
  return counts.map((count) => {
    const level = { base, count }
    base += count
    return level
  })
}

/** The members a tree over `roots` holds: every placement but the world DAG's (`world`). */
const membersOf = (roots: readonly unknown[], world: number) =>
  Array.from({ length: roots.length }, (_, w) => w).filter((w) => w !== world)

/**
 * The tree over every placement of `roots` but the world DAG's (`world`), laid out for `capacity`
 * member slots and `worlds` placements, its nodes from `cellBase` on, if they take one.
 */
export function placementTreeShape(
  roots: readonly Ordered[],
  world: number,
  capacity: { members: number; worlds: number },
  cellBase: number,
): PlacementTree | undefined {
  if (!groupsPlacements(capacity.members)) return undefined
  const members = membersOf(roots, world),
    order = new Uint32Array(capacity.members).fill(NO_INDEX),
    slot = new Uint32Array(capacity.worlds).fill(NO_INDEX)
  order.set(placementOrder(roots, members))
  for (let k = 0; k < members.length; k++) slot[order[k]] = k
  const levels = treeLevels(capacity.members),
    nodes = new Float32Array(levels.reduce((sum, level) => sum + level.count, 0) * DAG_NODE_FLOATS)
  return {
    ...{ capacity: capacity.members, count: members.length, cellBase, levels, nodes, order, slot },
    depth: levels.length,
    always: createMirroredKeys(),
  }
}

/** Nodes the tree holds: the queue entries it adds to the packing's nodes. */
export const treeNodeCount = (tree?: PlacementTree) =>
  tree ? tree.nodes.length / DAG_NODE_FLOATS : 0

/** Relative margin a box grows by: far above both tests' single-precision rounding (2⁻²⁴). */
export const MARGIN = 2 ** -16

/** A deformation reach's bits from an infinite half up: past every finite reach (`markReach`). */
export const REACH_UNBOUNDED = 0x7c00

/** Whether a placement of mark `mark` is drawn whatever the view: never culled, or deformed past
 *  every finite reach. Its root opens from queue 0, never through its group (`always`). */
export const drawnAlways = (mark: number) =>
  (mark & SPRITE_UNCULLED) !== 0 || mark >>> 16 >= REACH_UNBOUNDED

/** Whether a mark moving from `before` to `mark` moves what the tree holds of its placement: its
 *  leaf's reach, or whether it is drawn whatever the view. */
export const treeMarkMoved = (before: number, mark: number) =>
  before >>> 16 !== mark >>> 16 || drawnAlways(before) !== drawnAlways(mark)
