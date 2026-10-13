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
 * new groups in the order the full build gives them (`joinPlacementTree`), its nodes kept at the
 * end of the node table.
 * A group's members are consecutive in the tree's ORDER: the rows' own when a partition fills them
 * (a cell takes consecutive rows, `../../partition/rows.ts`, and gives them back together), else
 * the placements on a Morton curve of their positions, so a group is a patch of the world whatever
 * order the scene lists its nodes in. The order rides behind the cold records (`members`).
 *
 * A tree node's box is the WORLD box of its members — each root's box, grown in its own space by its
 * deformation's reach as its root test grows its planes (`primitiveWgsl.ts`), through its absolute
 * world —, tested against the frustum's render-frame planes once the eye is taken off it. It holds
 * every member's leaf, grown by a margin past the single-precision rounding of both tests, so a box
 * the tree rejects is one every member's root test would have rejected: the cut is unchanged. Every
 * box is finite: a member drawn whatever the view — never culled, or deformed past every finite
 * reach (`drawnAlways`) — is no group's to open; it is listed apart (`always`, behind the order in
 * the cold table) and opened from queue 0 with the tree's top (`placementTreeWgsl.ts`), its leaf
 * kept in its group for what walks the tree by boxes — a ray (`../../bounce/runtimeSceneWgsl.ts`).
 * A parked member, or a member slot no placement holds yet, holds nothing.
 *
 * The tree is built here — `packPlacementTree` fits every node once, as the tables are made —, and
 * refit on the GPU from then on (`treeRefit.ts`): what a pose, a park or a mark moved, over the
 * leaves a caller writes (`memberBox`, or a composition's own), bottom up.
 */
import { rowCell } from '../../partition/rowCells.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { clamp, clampLowWins } from '../../../../math/src/scalar/reals.ts'
import { boxTransform } from '../../../../sdk-core/src/index.ts'
import { SELECTION_NONE as NONE, SELECTION_WORKGROUP } from '../core/selection.ts'
import { SPRITE_UNCULLED } from '../../visibility/shader/spriteWgsl.ts'
import { DAG_NODE_FLOATS, type DagRoot, type PackedDag } from './types.ts'
import { FINITE_SENTINEL } from '../../../../math/src/constants.ts'
import { fromHalf } from '../../../../math/src/float/half.ts'
import { boxGrow } from '../../../../math/src/geometry/box.ts'
import { createMirroredKeys, mirrorKey, type MirroredKeys } from '../../webgpu/cut/denseKeys.ts'
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
export const TREE_SPAN = SELECTION_WORKGROUP
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
 * `members` on — a member slot a growth left before its new groups names none.
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
  /** Each placement's root box through its world as its last fit took it, six numbers a slot of
   *  the worlds: a refit transforms the moved members' alone and joins the others' kept. */
  boxes: Float64Array
  /** The members drawn whatever the view (`drawnAlways`), and the cold word their list lies from,
   *  behind the order: queue 0 opens them (`placementTreeWgsl.ts`). */
  always: MirroredKeys
  alwaysAt: number
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
  const levels = treeLevels(capacity.members, cellBase)
  return {
    ...{ capacity: capacity.members, count: members.length, cellBase, levels, order, slot },
    depth: levels.length,
    members: 0,
    boxes: new Float64Array(capacity.worlds * 6),
    always: createMirroredKeys(),
    alwaysAt: 0,
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

/** Relative margin a box grows by: far above both tests' single-precision rounding (2⁻²⁴). */
export const MARGIN = 2 ** -16

/** The members group `g` holds now: from its first, up to the live members. */
const groupMembers = (tree: PlacementTree, g: number) =>
  clampLowWins(tree.count - g * TREE_SPAN, 0, TREE_SPAN)

/**
 * Writes every tree node into `nodes` (`nodeInts` its words): children, kind, the world a range
 * dispatch reads them under (the first), no error to prune by, its box open until the refit fits it. A cell's
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
  // The boxes are the refit's (`treeRefit.ts`): every node holds the whole world until the first
  // cut fits it, over the leaves taken here.
  for (let k = 0; k < tree.count; k++) {
    const w = tree.order[k]
    memberBox(packed, tree, w)
    if (drawnAlways(packed.mark[w])) mirrorKey(tree.always, w, true)
  }
  for (const { base, count } of tree.levels)
    for (let j = 0; j < count; j++) wholeNode(packed.nodes, base + j)
}

/** Node `n` takes the box of the whole world, which no plane rejects: a node before its first fit. */
function wholeNode(nodes: Float32Array, n: number) {
  const at = n * DAG_NODE_FLOATS
  for (let a = 0; a < 3; a++) {
    nodes[at + NODE_MIN + a] = -FINITE_SENTINEL
    nodes[at + NODE_MAX + a] = FINITE_SENTINEL
  }
}

/** The member slot the next batch a growth appends starts at: the first of a new group, so no
 *  group holds placements of two batches. */
export const joinStart = (tree: PlacementTree) => ceilDiv(tree.count, TREE_SPAN) * TREE_SPAN

/**
 * Placements `batch`, appended to the packing in place, ordered as the full build orders its
 * members (`placementOrder`) and filling new groups from `joinStart`: each group's box covers its
 * own members alone. Their order words, slots and groups' member counts; returns the tree nodes
 * whose words changed — the new groups, their boxes left to the refit — and the member slots
 * taken, `[from, to)`, whose words the cold table sends.
 */
export function joinPlacementTree(packed: TreeSource, tree: PlacementTree, batch: number[]) {
  const from = joinStart(tree)
  if (from + batch.length > tree.capacity) throw new Error('GPU_PLACEMENT_TREE_FULL')
  const order = placementOrder(packed.worldSources, batch),
    nodeInts = new Uint32Array(packed.nodes.buffer, packed.nodes.byteOffset)
  order.forEach((w, i) => {
    tree.order[from + i] = w
    tree.slot[w] = from + i
    if (drawnAlways(packed.mark[w])) mirrorKey(tree.always, w, true)
  })
  tree.count = from + batch.length
  const groups = groupLevel(tree).base,
    nodes: number[] = []
  for (let g = from / TREE_SPAN; g * TREE_SPAN < tree.count; g++) {
    nodeInts[(groups + g) * DAG_NODE_FLOATS + NODE_CHILD_COUNT] = groupMembers(tree, g)
    nodes.push(groups + g)
  }
  return { nodes: Int32Array.from(nodes), members: [from, tree.count] as const }
}

/** A deformation reach's bits from an infinite half up: past every finite reach (`markReach`). */
export const REACH_UNBOUNDED = 0x7c00

/** Whether a placement of mark `mark` is drawn whatever the view: never culled, or deformed past
 *  every finite reach. Its root opens from queue 0, never through its group (`always`). */
export const drawnAlways = (mark: number) =>
  (mark & SPRITE_UNCULLED) !== 0 || mark >>> 16 >= REACH_UNBOUNDED

/** The reach a placement of mark `mark` grows its leaf by, in its own space: the half its root test
 *  grows its planes by (`reachOf`), none past every finite one — `drawnAlways` draws it. */
const leafReach = (mark: number) => {
  const bits = mark >>> 16
  return bits && bits < REACH_UNBOUNDED ? fromHalf(bits) : 0
}

/** Whether a mark moving from `before` to `mark` moves what the tree holds of its placement: its
 *  leaf's reach, or whether it is drawn whatever the view. */
export const treeMarkMoved = (before: number, mark: number) =>
  before >>> 16 !== mark >>> 16 || drawnAlways(before) !== drawnAlways(mark)

const box = new Float64Array(12)

/** Member `w`'s leaf, kept in `tree.boxes`: its root box grown by its reach (`leafReach`) through
 *  its world, taken when it moved, the refit joining the kept one. A parked member, or one without
 *  a root, keeps none. */
export function memberBox(packed: TreeSource, tree: PlacementTree, w: number) {
  if (w === NONE || packed.rootNodes[w] === NONE) return
  const root = packed.rootBases[w] * DAG_NODE_FLOATS,
    nodes = packed.nodes
  for (let a = 0; a < 3; a++) {
    box[a] = nodes[root + NODE_MIN + a]
    box[3 + a] = nodes[root + NODE_MAX + a]
  }
  boxGrow(box, 6, box, 0, leafReach(packed.mark[w]))
  boxTransform(tree.boxes, w * 6, box, 6, packed.worldSources[w].world.elements)
}

/**
 * THE ONE REFIT SCHEDULE: the nodes to fit at each of `levels` levels once `touched` changed, bottom up
 * — the deepest level (`levels − 1`) first, level 0 the root's —, each level's ids increasing. A level
 * holds the nodes touched at it and the parents (`above`) of those the level below holds, and, when
 * `own` names them, the nodes it always holds: a fit of a whole structure names its nodes by level,
 * the fit of a change names the groups the change touched. The placement tree's refit
 * (`refitLevels`) and a mesh's proxy pose (`bounce/runtimePoseLevels.ts`) fit their boxes by it.
 */
export function refitSchedule(
  levels: number,
  touched: Iterable<number>,
  above: (level: number, id: number) => number,
  own?: (level: number) => Iterable<number>,
) {
  let carried = new Set(touched)
  const schedule: { level: number; ids: Uint32Array<ArrayBuffer> }[] = []
  for (let l = levels - 1; l >= 0; l--) {
    const here = new Set(carried)
    if (own) for (const id of own(l)) here.add(id)
    if (!here.size) {
      carried = here
      continue
    }
    schedule.push({ level: l, ids: new Uint32Array([...here].sort((a, b) => a - b)) })
    const parents = new Set<number>()
    if (l > 0) for (const id of here) parents.add(above(l, id))
    carried = parents
  }
  return schedule
}

/** The nodes to fit at each level of `tree` once `groups` changed, bottom up: each level's, as
 *  their index within it, increasing (`refitSchedule`). */
export const refitLevels = (tree: PlacementTree, groups: Iterable<number>) =>
  refitSchedule(tree.levels.length, groups, (_level, id) => Math.floor(id / TREE_SPAN))
