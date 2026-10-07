/**
 * THE PLACEMENT TREE: CELLS, THEN INSTANCE GROUPS, ABOVE EVERY PLACEMENT'S OWN HIERARCHY.
 *
 * The cut descends each placement's culling hierarchy level by level (`shader/levelWgsl.ts`); it
 * used to start from every placement's root, so a frame paid every placement of the world — its
 * planes brought into the placement's space, its matrices, its root's test — whether the view held
 * it or not. The tree puts two levels of the same `CullNode`s above them, in the same descent, no
 * second traversal: an instance GROUP bounds up to `TREE_SPAN` placements, a CELL up to `TREE_SPAN`
 * consecutive groups. Cells start the descent; a kept group deposits its placements, each prepared
 * then where it is read (`placementTreeWgsl.ts`), and a rejected one costs its members nothing.
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
 * — opens its group and its cell: they are never rejected. A parked member holds nothing.
 */
import {
  boxEmpty,
  boxTransform,
  boxUnion,
  frustumExcludesBox,
} from '../../../../sdk-core/src/index.ts'
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

/** Placements a group bounds, and groups a cell bounds: one workgroup's lanes each. */
const TREE_SPAN = SELECTION_WORKGROUP
/** Levels the tree sets above a grouped placement's root: its cell's, its group's. */
export const TREE_LEVELS = 2
/** A node's kind (`NODE_KIND`): a cell, whose children are groups; a group, whose children are
 *  placements. Zero is a placement's own node. */
const TREE_CELL = 1
export const TREE_GROUP = 2

/** Where the tree lies in the packing: placements `[0, grouped)` are grouped; its cells, then its
 *  groups, are nodes from `cellBase` on; `order[k]` is the placement member `k` names, `slot[w]` the
 *  member placement `w` is, and the order lies in the cold table from word `members` on. `open[w]`:
 *  the group of `w` stays open whatever its mark (a pose the GPU composes). */
export type PlacementTree = {
  grouped: number
  cellBase: number
  cells: number
  groups: number
  order: Uint32Array
  slot: Uint32Array
  members: number
  open: Uint8Array
}

/** Whether `grouped` placements take a tree: not when one group would hold them all, a cell of one
 *  group saving the descent nothing. */
export const groupsPlacements = (grouped: number) => grouped > TREE_SPAN

/** The tree over the `grouped` first of `roots`, whose nodes start at `nodeBase`, if they take one. */
export function placementTreeShape(
  roots: readonly Pick<DagRoot, 'world' | 'parked'>[],
  grouped: number,
  nodeBase: number,
): PlacementTree | undefined {
  if (!groupsPlacements(grouped)) return undefined
  const groups = Math.ceil(grouped / TREE_SPAN),
    order = placementOrder(roots, grouped),
    slot = new Uint32Array(grouped)
  for (let k = 0; k < grouped; k++) slot[order[k]] = k
  const cells = Math.ceil(groups / TREE_SPAN),
    open = new Uint8Array(grouped)
  return { grouped, cellBase: nodeBase, cells, groups, order, slot, members: 0, open }
}

/** Bits a coordinate takes in a Morton code: three of them hold in a double's integer with the
 *  rank beside them, up to `2 ** (53 - 3 * MORTON_BITS)` placements. */
const MORTON_BITS = 10

/**
 * The tree's order: the rows' own when any is parked — rows a partition fills and empties —, else
 * the placements sorted on the Morton curve of their translations over the box that holds them.
 */
function placementOrder(roots: readonly Pick<DagRoot, 'world' | 'parked'>[], grouped: number) {
  const order = Uint32Array.from({ length: grouped }, (_, k) => k)
  const rankBits = 53 - 3 * MORTON_BITS
  if (grouped > 2 ** rankBits || roots.some((root, w) => w < grouped && root.parked)) return order
  const low = [Infinity, Infinity, Infinity],
    high = [-Infinity, -Infinity, -Infinity]
  for (let w = 0; w < grouped; w++)
    for (let a = 0; a < 3; a++) {
      const t = roots[w].world.elements[12 + a]
      low[a] = Math.min(low[a], t)
      high[a] = Math.max(high[a], t)
    }
  const cells = 2 ** MORTON_BITS - 1,
    keys = new Float64Array(grouped)
  for (let w = 0; w < grouped; w++) {
    let code = 0
    for (let a = 0; a < 3; a++) {
      const span = high[a] - low[a],
        q = span > 0 ? Math.floor(((roots[w].world.elements[12 + a] - low[a]) / span) * cells) : 0
      code += spread(Math.min(cells, Math.max(0, q || 0))) * 2 ** a
    }
    keys[w] = code * 2 ** rankBits + w
  }
  keys.sort()
  for (let k = 0; k < grouped; k++) order[k] = keys[k] % 2 ** rankBits
  return order
}

/** `q`'s bits spread three apart, the first at bit 0: one axis of a Morton code. */
function spread(q: number) {
  let code = 0
  for (let bit = 0; bit < MORTON_BITS; bit++) if (q & (1 << bit)) code += 2 ** (3 * bit)
  return code
}

/** Nodes the tree adds to the packing. */
export const treeNodeCount = (tree?: PlacementTree) => (tree ? tree.cells + tree.groups : 0)

/** The first node of the tree's groups. */
const groupBase = (tree: PlacementTree) => tree.cellBase + tree.cells

/** What the tree reads of the packing: each placement's root box, its absolute world, its mark. */
type TreeSource = Pick<PackedDag, 'nodes' | 'rootNodes' | 'rootBases' | 'mark' | 'worldSources'>

/** Twice a float's largest finite value: an open box's bounds, past every plane. */
const OPEN = 3.4e38
/** Relative margin a box grows by: far above both tests' single-precision rounding (2⁻²⁴). */
const MARGIN = 2 ** -16

/**
 * Writes every tree node into `nodes` (`nodeInts` its words): children, kind, the world a range
 * dispatch reads them under (the first), no error to prune by, and each box fitted.
 */
export function packPlacementTree(packed: TreeSource, tree: PlacementTree) {
  const nodeInts = new Uint32Array(packed.nodes.buffer, packed.nodes.byteOffset)
  for (let k = 0; k < tree.cells + tree.groups; k++) {
    const cell = k < tree.cells,
      at = (tree.cellBase + k) * DAG_NODE_FLOATS,
      span = cell ? tree.groups : tree.grouped,
      first = (cell ? k : k - tree.cells) * TREE_SPAN
    nodeInts[at + NODE_FIRST_CHILD] = cell ? groupBase(tree) + first : first
    nodeInts[at + NODE_CHILD_COUNT] = Math.min(TREE_SPAN, span - first)
    nodeInts[at + NODE_KIND] = cell ? TREE_CELL : TREE_GROUP
    nodeInts[at + NODE_WORLD] = 0
    packed.nodes[at + NODE_CEIL] = -1
    packed.nodes[at + NODE_FLOOR] = 0
  }
  fitPlacementTree(packed, tree)
}

/** Fits every group, then every cell: at pack, and after poses moved past what a list names. */
export function fitPlacementTree(packed: TreeSource, tree: PlacementTree) {
  for (let g = 0; g < tree.groups; g++) fitGroup(packed, tree, g)
  for (let c = 0; c < tree.cells; c++) fitCell(packed, tree, c)
}

/**
 * Fits again the groups of `placements` and their cells, after a pose, a park or a mark moved;
 * returns the tree nodes it rewrote: the cells', then the groups'.
 */
export function refitPlacementTree(
  packed: TreeSource,
  tree: PlacementTree,
  placements: Iterable<number>,
) {
  const groups = new Set<number>()
  for (const w of placements) if (w < tree.grouped) groups.add(Math.floor(tree.slot[w] / TREE_SPAN))
  const cells = new Set<number>()
  for (const g of groups) {
    fitGroup(packed, tree, g)
    cells.add(Math.floor(g / TREE_SPAN))
  }
  for (const c of cells) fitCell(packed, tree, c)
  return [
    ...[...cells].map((c) => tree.cellBase + c),
    ...[...groups].map((g) => groupBase(tree) + g),
  ]
}

/**
 * Hands `visit` every placement the camera's frustum (`planes`, absolute, as the CPU tests boxes)
 * may hold: the members of the groups whose box meets it, in cells whose box does, then every
 * placement the tree leaves out. What the tree culls is what the cut's descent culls first, so the
 * CPU's per-placement work in a frame — the impostor plan — follows the view as the GPU's does.
 */
export function visitPlacements(
  packed: Pick<PackedDag, 'nodes' | 'worldCount'>,
  tree: PlacementTree,
  planes: Float64Array,
  visit: (placement: number) => void,
) {
  const { nodes } = packed,
    groups = groupBase(tree)
  const outside = (n: number) => {
    const at = n * DAG_NODE_FLOATS
    return frustumExcludesBox(
      planes,
      nodes[at + NODE_MIN],
      nodes[at + NODE_MIN + 1],
      nodes[at + NODE_MIN + 2],
      nodes[at + NODE_MAX],
      nodes[at + NODE_MAX + 1],
      nodes[at + NODE_MAX + 2],
    )
  }
  for (let c = 0; c < tree.cells; c++) {
    if (outside(tree.cellBase + c)) continue
    for (let g = c * TREE_SPAN; g < Math.min(tree.groups, (c + 1) * TREE_SPAN); g++) {
      if (outside(groups + g)) continue
      const end = Math.min(tree.grouped, (g + 1) * TREE_SPAN)
      for (let k = g * TREE_SPAN; k < end; k++) visit(tree.order[k])
    }
  }
  for (let w = tree.grouped; w < packed.worldCount; w++) visit(w)
}

/** Whether placement `w`'s box cannot hold its pose: never culled, or deformed by a reach. */
export const opensTree = (mark: number) => (mark & SPRITE_UNCULLED) !== 0 || mark >>> 16 !== 0

const box = new Float64Array(12)

/** Group `g`'s box: its members' root boxes through their worlds, parked ones left out. */
function fitGroup(packed: TreeSource, tree: PlacementTree, g: number) {
  boxEmpty(box, 0)
  let opened = false
  const end = Math.min(tree.grouped, (g + 1) * TREE_SPAN)
  for (let k = g * TREE_SPAN; k < end && !opened; k++) {
    const w = tree.order[k]
    if (packed.rootNodes[w] === NONE) continue
    opened = tree.open[w] !== 0 || opensTree(packed.mark[w])
    const root = packed.rootBases[w] * DAG_NODE_FLOATS,
      { nodes } = packed
    box.set(nodes.subarray(root + NODE_MIN, root + NODE_MIN + 3), 6)
    box.set(nodes.subarray(root + NODE_MAX, root + NODE_MAX + 3), 9)
    boxTransform(box, 6, box, 6, packed.worldSources![w].world.elements)
    boxUnion(box, 0, box[6], box[7], box[8], box[9], box[10], box[11])
  }
  writeBox(packed.nodes, groupBase(tree) + g, opened)
}

/** Cell `c`'s box: its groups'. */
function fitCell(packed: TreeSource, tree: PlacementTree, c: number) {
  boxEmpty(box, 0)
  const end = Math.min(tree.groups, (c + 1) * TREE_SPAN)
  for (let g = c * TREE_SPAN; g < end; g++) {
    const at = (groupBase(tree) + g) * DAG_NODE_FLOATS + NODE_MIN,
      { nodes } = packed
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
  // A cell holding an open group is open.
  writeBox(packed.nodes, tree.cellBase + c, box[0] <= -OPEN)
}

/**
 * Writes `box[0..6)` as node `n`'s bounds, grown by `MARGIN` of its farthest coordinate and its
 * widest side; an open node takes bounds no plane rejects, an empty one bounds every plane does.
 */
function writeBox(nodes: Float32Array, n: number, opened: boolean) {
  const at = n * DAG_NODE_FLOATS
  if (opened) {
    for (let a = 0; a < 3; a++) [nodes[at + NODE_MIN + a], nodes[at + NODE_MAX + a]] = [-OPEN, OPEN]
    return
  }
  if (!(box[3] >= box[0] && box[4] >= box[1] && box[5] >= box[2])) {
    for (let a = 0; a < 3; a++) [nodes[at + NODE_MIN + a], nodes[at + NODE_MAX + a]] = [OPEN, -OPEN]
    return
  }
  let reach = 0
  for (let a = 0; a < 6; a++) reach = Math.max(reach, Math.abs(box[a]))
  for (let a = 0; a < 3; a++) reach = Math.max(reach, box[a + 3] - box[a])
  const grow = reach * MARGIN
  for (let a = 0; a < 3; a++) {
    nodes[at + NODE_MIN + a] = box[a] - grow
    nodes[at + NODE_MAX + a] = box[a + 3] + grow
  }
}
