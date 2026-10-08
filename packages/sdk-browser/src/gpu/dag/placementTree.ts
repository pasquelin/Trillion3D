/**
 * THE PLACEMENT TREE: CELLS, THEN INSTANCE GROUPS, ABOVE EVERY PLACEMENT'S OWN HIERARCHY.
 *
 * The cut descends each placement's culling hierarchy level by level (`shader/levelWgsl.ts`); it
 * used to start from every placement's root, so a frame paid every placement of the world — its
 * planes brought into the placement's space, its matrices, its root's test — whether the view held
 * it or not. The tree puts two levels of the same `CullNode`s above them, in the same descent, no
 * second traversal: an instance GROUP bounds up to `TREE_SPAN` placements, a CELL up to `TREE_SPAN`
 * nodes of the level below. Its top level starts the descent; a kept group deposits its placements,
 * each prepared then where it is read (`placementTreeWgsl.ts`), and a rejected one costs its members
 * nothing. Every placement but the world DAG's is a member, wherever it sits in the packing, and
 * the tree is laid out for the packing's capacity: the placements a growth appends in place fill
 * new groups in the order the full build gives them (`joinPlacementTree`), its nodes kept at the
 * end of the node table.
 * A group's members are consecutive in the tree's ORDER: the rows' own when a partition fills them
 * (a cell takes consecutive rows, `../../partition/rows.ts`, and gives them back together), else
 * the placements on a Morton curve of their positions, so a group is a patch of the world whatever
 * order the scene lists its nodes in. The order rides behind the cold records (`members`).
 *
 * A tree node's box is the WORLD box of its members — each root's box through its absolute
 * world —, tested against the frustum's render-frame planes once the eye is taken off it. It holds
 * every member's root box, grown by a margin past the single-precision rounding of both tests, so a
 * box the tree rejects is one every member's root test would have rejected: the cut is unchanged.
 * A member whose pose the box cannot hold — never culled, deformed by a reach, composed on the GPU
 * — opens its group and every node above it: they are never rejected, said by an explicit flag
 * (`nodeOpen`). A parked member, or a member slot no placement holds yet, holds nothing.
 */
import { rowCell } from '../../partition/rowCells.ts'
import { boxGrow } from '../../../../math/src/geometry/box.ts'
import { createSortedKeys, takeSorted } from '../../webgpu/cut/denseKeys.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { clamp, clampLowWins } from '../../../../math/src/scalar/reals.ts'
import { boxEmpty, boxTransform, boxUnion } from '../../../../sdk-core/src/index.ts'
import { SELECTION_NONE as NONE, SELECTION_WORKGROUP } from '../core/selection.ts'
import { SPRITE_UNCULLED } from '../../visibility/shader/spriteWgsl.ts'
import { DAG_NODE_FLOATS, type DagRoot, type PackedDag } from './types.ts'
import {
  NODE_CEIL,
  NODE_CHILD_COUNT,
  NODE_FIRST_CHILD,
  NODE_FLOOR,
  NODE_KIND,
  NODE_MAX,
  NODE_MIN,
  NODE_WORLD,
} from './nodeLayout.ts'

/** Placements a group bounds, and nodes of the level below a cell bounds: one workgroup's lanes. */
const TREE_SPAN = SELECTION_WORKGROUP
/** A node's kind (`NODE_KIND`): a cell, whose children are nodes of the level below; a group, whose
 *  children are placements. Zero is a placement's own node. */
const TREE_CELL = 1
export const TREE_GROUP = 2

/** One level of the tree: its first node and its node count. */
type TreeLevel = { base: number; count: number }

/**
 * Where the tree lies in the packing: its `levels`, top first, the last its groups, nodes from
 * `cellBase` on; `depth` the levels it sets above a member's root. `order[k]` is the placement
 * member `k` names (`NONE` past the `count` live members, up to `capacity`), `slot[w]` the member
 * placement `w` is (`NONE` for the world DAG), and the order lies in the cold table from word
 * `members` on — a member slot a growth left before its new groups names none. `composed(w)`: the
 * group of `w` stays open whatever its mark (a pose the GPU composes, `treeFollow.ts`);
 * `nodeOpen[n]`: tree node `cellBase + n` is open.
 */
export type PlacementTree = {
  capacity: number
  count: number
  cellBase: number
  depth: number
  levels: TreeLevel[]
  order: Uint32Array
  slot: Uint32Array
  members: number
  composed: (w: number) => boolean
  nodeOpen: Uint8Array
  /** Each placement's root box through its world as its last fit took it, six numbers a slot of
   *  the worlds: a refit transforms the moved members' alone and joins the others' kept. */
  boxes: Float64Array
}

/** Whether `members` member slots take a tree: not when one group would hold them all, a cell of
 *  one group saving the descent nothing. */
const groupsPlacements = (members: number) => members > TREE_SPAN

/** The levels of a tree of `capacity` members, top first: groups of `TREE_SPAN` members, cells of
 *  `TREE_SPAN` nodes of the level below, `ceil(log64 capacity)` levels in all, so its top is one
 *  node whatever the world: the descent opens on it alone. */
function treeLevels(capacity: number, cellBase: number) {
  let depth = 1
  for (let span = TREE_SPAN; span < capacity; span *= TREE_SPAN) depth++
  const counts = [ceilDiv(capacity, TREE_SPAN)]
  while (counts.length < depth) counts.unshift(ceilDiv(counts[0], TREE_SPAN))
  let base = cellBase
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
    order = new Uint32Array(capacity.members).fill(NONE),
    slot = new Uint32Array(capacity.worlds).fill(NONE)
  order.set(placementOrder(roots, members))
  for (let k = 0; k < members.length; k++) slot[order[k]] = k
  const levels = treeLevels(capacity.members, cellBase),
    nodes = levels.reduce((sum, level) => sum + level.count, 0)
  return {
    ...{ capacity: capacity.members, count: members.length, cellBase, levels, order, slot },
    depth: levels.length,
    members: 0,
    composed: () => false,
    nodeOpen: new Uint8Array(nodes),
    boxes: new Float64Array(capacity.worlds * 6),
  }
}

/** Bits a coordinate takes in a Morton code: three of them hold in a double's integer with the
 *  rank beside them, up to `2 ** (53 - 3 * MORTON_BITS)` placements. */
const MORTON_BITS = 10

/** The cell a partition placed placement `w`'s row in, or none. */
type Ordered = Pick<DagRoot, 'world' | 'placement'>
const cellOf = (roots: readonly Ordered[], w: number) => {
  const placement = roots[w].placement
  return placement ? rowCell(placement.rows, placement.index)?.cell : undefined
}

/**
 * The tree's order of `members`: a partition's rows by their cell, the cell's together, then every
 * other placement on the Morton curve of its translation over the box that holds them — a cell's
 * rows lie together however its rows were filled, the others side by side as they stand.
 */
function placementOrder(roots: readonly Ordered[], members: number[]) {
  const rankBits = 53 - 3 * MORTON_BITS
  if (roots.length > 2 ** rankBits) return Uint32Array.from(members)
  const celled: number[] = [],
    free: number[] = []
  for (const w of members) (cellOf(roots, w) === undefined ? free : celled).push(w)
  celled.sort((a, b) => cellOf(roots, a)! - cellOf(roots, b)! || a - b)
  const order = new Uint32Array(members.length)
  order.set(celled)
  order.set(mortonOrder(roots, free, rankBits), celled.length)
  return order
}

/** `members` sorted on the Morton curve of their translations over the box that holds them. */
function mortonOrder(roots: readonly Ordered[], members: number[], rankBits: number) {
  const low = [Infinity, Infinity, Infinity],
    high = [-Infinity, -Infinity, -Infinity]
  for (const w of members)
    for (let a = 0; a < 3; a++) {
      const t = roots[w].world.elements[12 + a]
      low[a] = Math.min(low[a], t)
      high[a] = Math.max(high[a], t)
    }
  const cells = 2 ** MORTON_BITS - 1,
    keys = new Float64Array(members.length)
  members.forEach((w, k) => {
    let code = 0
    for (let a = 0; a < 3; a++) {
      const span = high[a] - low[a],
        q = span > 0 ? Math.floor(((roots[w].world.elements[12 + a] - low[a]) / span) * cells) : 0
      code += spread(clamp(q || 0, 0, cells)) * 2 ** a
    }
    keys[k] = code * 2 ** rankBits + w
  })
  keys.sort()
  return Array.from(keys, (key) => key % 2 ** rankBits)
}

/** `q`'s bits spread three apart, the first at bit 0: one axis of a Morton code. */
function spread(q: number) {
  let code = 0
  for (let bit = 0; bit < MORTON_BITS; bit++) if (q & (1 << bit)) code += 2 ** (3 * bit)
  return code
}

/** Nodes the tree adds to the packing. */
export const treeNodeCount = (tree?: PlacementTree) =>
  tree ? tree.levels.reduce((sum, level) => sum + level.count, 0) : 0

/** The tree's groups: its last level. */
const groupLevel = (tree: PlacementTree) => tree.levels[tree.levels.length - 1]

/** What the tree reads of the packing: each placement's root box, its absolute world, its mark. */
type TreeSource = Pick<PackedDag, 'nodes' | 'rootNodes' | 'rootBases' | 'mark' | 'worldSources'>

/** Twice a float's largest finite value: an open box's bounds, past every plane. */
const OPEN = 3.4e38
/** Relative margin a box grows by: far above both tests' single-precision rounding (2⁻²⁴). */
const MARGIN = 2 ** -16

/** The members group `g` holds now: from its first, up to the live members. */
const groupMembers = (tree: PlacementTree, g: number) =>
  clampLowWins(tree.count - g * TREE_SPAN, 0, TREE_SPAN)

/**
 * Writes every tree node into `nodes` (`nodeInts` its words): children, kind, the world a range
 * dispatch reads them under (the first), no error to prune by, and each box fitted. A cell's
 * children are every node of the level below it lays out; a group's, its live members.
 */
export function packPlacementTree(packed: TreeSource, tree: PlacementTree) {
  const nodeInts = new Uint32Array(packed.nodes.buffer, packed.nodes.byteOffset)
  tree.levels.forEach(({ base, count }, l) => {
    const below = tree.levels[l + 1]
    for (let j = 0; j < count; j++) {
      const at = (base + j) * DAG_NODE_FLOATS,
        first = j * TREE_SPAN
      nodeInts[at + NODE_FIRST_CHILD] = below ? below.base + first : first
      nodeInts[at + NODE_CHILD_COUNT] = below
        ? Math.min(TREE_SPAN, below.count - first)
        : groupMembers(tree, j)
      nodeInts[at + NODE_KIND] = below ? TREE_CELL : TREE_GROUP
      nodeInts[at + NODE_WORLD] = 0
      packed.nodes[at + NODE_CEIL] = -1
      packed.nodes[at + NODE_FLOOR] = 0
    }
  })
  fitPlacementTree(packed, tree)
}

/** The member slot the next batch a growth appends starts at: the first of a new group, so no
 *  group holds placements of two batches. */
export const joinStart = (tree: PlacementTree) => ceilDiv(tree.count, TREE_SPAN) * TREE_SPAN

/**
 * Placements `batch`, appended to the packing in place, ordered as the full build orders its
 * members (`placementOrder`) and filling new groups from `joinStart`: each group's box covers its
 * own members alone. Their order words, slots and groups' member counts; returns the tree nodes
 * rewritten and the member slots taken, `[from, to)`, whose words the cold table sends.
 */
export function joinPlacementTree(packed: TreeSource, tree: PlacementTree, batch: number[]) {
  const from = joinStart(tree)
  if (from + batch.length > tree.capacity) throw new Error('GPU_PLACEMENT_TREE_FULL')
  const order = placementOrder(packed.worldSources, batch),
    nodeInts = new Uint32Array(packed.nodes.buffer, packed.nodes.byteOffset)
  order.forEach((w, i) => {
    tree.order[from + i] = w
    tree.slot[w] = from + i
  })
  tree.count = from + batch.length
  const groups = groupLevel(tree).base
  for (let g = from / TREE_SPAN; g * TREE_SPAN < tree.count; g++)
    nodeInts[(groups + g) * DAG_NODE_FLOATS + NODE_CHILD_COUNT] = groupMembers(tree, g)
  // A copy of the refit's view, which the next refit overwrites: the append sends it later.
  const nodes = refitPlacementTree(packed, tree, batch).slice()
  return { nodes, members: [from, tree.count] as const }
}

/** Fits every group, then every level above, bottom up: at pack, and after poses moved past what a
 *  list names. */
export function fitPlacementTree(packed: TreeSource, tree: PlacementTree) {
  for (let k = 0; k < tree.count; k++) takeBox(packed, tree, tree.order[k])
  for (let l = tree.levels.length - 1; l >= 0; l--)
    for (let j = 0; j < tree.levels[l].count; j++) fitNode(packed, tree, l, j)
}

/**
 * Fits again the groups of `placements` and every node above them, after a pose, a park or a mark
 * moved; returns the tree nodes it rewrote, ascending.
 */
export function refitPlacementTree(
  packed: TreeSource,
  tree: PlacementTree,
  placements: Iterable<number>,
) {
  let [touched, above] = refitSets
  touched.clear()
  for (const w of placements)
    if (tree.slot[w] !== NONE) {
      takeBox(packed, tree, w)
      touched.add(Math.floor(tree.slot[w] / TREE_SPAN))
    }
  for (let l = tree.levels.length - 1; l >= 0 && touched.size; l--) {
    above.clear()
    for (const j of touched) {
      fitNode(packed, tree, l, j)
      rewritten.listed.add(tree.levels[l].base + j)
      above.add(Math.floor(j / TREE_SPAN))
    }
    ;[touched, above] = [above, touched]
  }
  return takeSorted(rewritten)
}

/** The nodes a refit fits at one level and those above them, and the nodes it rewrote, kept from
 *  one refit to the next: what it returns is a view the next refit overwrites. */
const refitSets = [new Set<number>(), new Set<number>()],
  rewritten = createSortedKeys()

/** Whether placement `w`'s box cannot hold its pose: never culled, or deformed by a reach. */
export const opensTree = (mark: number) => (mark & SPRITE_UNCULLED) !== 0 || mark >>> 16 !== 0

const box = new Float64Array(12)

/** Node `j` of level `l`: a group's box over its members' root boxes through their worlds, parked
 *  ones left out; a cell's over its children's. Open when one of them is. */
function fitNode(packed: TreeSource, tree: PlacementTree, l: number, j: number) {
  boxEmpty(box, 0)
  const below = tree.levels[l + 1],
    first = j * TREE_SPAN
  let opened = false
  if (below)
    for (let c = first; c < Math.min(first + TREE_SPAN, below.count) && !opened; c++) {
      opened = tree.nodeOpen[below.base + c - tree.cellBase] !== 0
      unionNode(packed.nodes, below.base + c)
    }
  else
    for (let k = first; k < first + groupMembers(tree, j) && !opened; k++)
      opened = unionMember(packed, tree, tree.order[k])
  const n = tree.levels[l].base + j
  tree.nodeOpen[n - tree.cellBase] = opened ? 1 : 0
  writeBox(packed.nodes, n, opened)
}

/** Member `w`'s root box through its world, kept in `tree.boxes`: taken when it moved, its group's
 *  refit joining the kept one. A parked member, or one without a root, keeps none. */
function takeBox(packed: TreeSource, tree: PlacementTree, w: number) {
  if (w === NONE || packed.rootNodes[w] === NONE) return
  const root = packed.rootBases[w] * DAG_NODE_FLOATS,
    nodes = packed.nodes
  for (let a = 0; a < 3; a++) {
    box[6 + a] = nodes[root + NODE_MIN + a]
    box[9 + a] = nodes[root + NODE_MAX + a]
  }
  boxTransform(tree.boxes, w * 6, box, 6, packed.worldSources[w].world.elements)
}

/** Member `w`'s kept box (`takeBox`) joined to `box`; whether it opens its group. */
function unionMember(packed: TreeSource, tree: PlacementTree, w: number) {
  if (w === NONE || packed.rootNodes[w] === NONE) return false
  if (tree.composed(w) || opensTree(packed.mark[w])) return true
  const b = tree.boxes,
    at = w * 6
  boxUnion(box, 0, b[at], b[at + 1], b[at + 2], b[at + 3], b[at + 4], b[at + 5])
  return false
}

/** Tree node `n`'s box joined to `box`. */
function unionNode(nodes: Float32Array, n: number) {
  const at = n * DAG_NODE_FLOATS + NODE_MIN
  boxUnion(
    box,
    0,
    nodes[at],
    nodes[at + 1],
    nodes[at + 2],
    nodes[at + 4],
    nodes[at + 5],
    nodes[at + 6],
  )
}

/**
 * Writes `box[0..6)` as node `n`'s bounds, grown by `MARGIN` of its farthest coordinate and its
 * widest side; an open node takes bounds no plane rejects, an empty one bounds every plane does.
 */
function writeBox(nodes: Float32Array, n: number, opened: boolean) {
  const at = n * DAG_NODE_FLOATS
  // Open, bounds no plane rejects; empty, bounds every plane does.
  const empty = !(box[3] >= box[0] && box[4] >= box[1] && box[5] >= box[2])
  if (opened || empty) {
    const low = opened ? -OPEN : OPEN
    for (let a = 0; a < 3; a++) {
      nodes[at + NODE_MIN + a] = low
      nodes[at + NODE_MAX + a] = -low
    }
    return
  }
  let reach = 0
  for (let a = 0; a < 6; a++) reach = Math.max(reach, Math.abs(box[a]))
  for (let a = 0; a < 3; a++) reach = Math.max(reach, box[a + 3] - box[a])
  boxGrow(grownBox, 0, box, 0, reach * MARGIN)
  for (let a = 0; a < 3; a++) {
    nodes[at + NODE_MIN + a] = grownBox[a]
    nodes[at + NODE_MAX + a] = grownBox[a + 3]
  }
}
/** A node's box grown by its margin, before its corners are written apart (`NODE_MIN`,
 *  `NODE_MAX`). */
const grownBox = new Float64Array(6)
