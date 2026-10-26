// The tree refit (`treeRefitWgsl.ts`, the shipped WGSL run in JavaScript) over a packing's tables:
// the one fit a test has of the placement tree, there being no other (`packPlacementTree` leaves
// every node open), over the leaves the GPU writes from the packing as it stands (`leafBoxes`). The
// tree's record table and the frame words are held in words (`treeTable.ts`, `../frameTable.ts`).
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import {
  LEAF_DOUBLES,
  LEAF_STRIDE_CONSTANT,
  leafStride,
  PARENT_LEAF,
  REACH_UNBOUNDED,
  treeNodeCount,
  TREE_SPAN,
  type PlacementTree,
} from '../placement/placementTree.ts'
import { refitLevels } from '../refitSchedule.ts'
import { boxTransform, boxGrow } from '../../../../../math/src/geometry/box.ts'

import { fromHalf } from '../../../../../math/src/float/half.ts'
import { NO_INDEX } from '../../../../../math/src/constants.ts'
import { NODE_MAX, NODE_MIN } from '../nodeLayout.ts'
import { SPRITE_UNCULLED } from '../../../visibility/shader/spriteWgsl.ts'
import { mirrorKey } from '../../cut/adoption/denseKeys.ts'
import { TREE_REFIT_WGSL } from './treeRefitWgsl.ts'
import { TREE_LEAVES_WGSL } from '../../../placement/tree/treeLeavesWgsl.ts'
import { NODE_TABLE } from '../nodeTable.ts'
import {
  DOUBLE_HELPERS,
  pair,
  type Pair,
} from '../../../placement/compose/composeDoubles.fixture.ts'
import { DAG_NODE_FLOATS, FRAME_ROW_WORDS, type DagRoot, type PackedDag } from '../types.ts'
import { recordTable } from '../../../gpu/core/recordTexture.fixture.ts'
import { TREE_TABLE } from './treeTable.ts'
import {
  DRAW_FAR_WORD,
  DRAW_NEAR_WORD,
  FRAME_TABLE,
  MARK_WORD,
  PARENT_WORD,
  ROOT_WORD,
} from '../frameTable.ts'
import { f32Bits, fromF32Bits } from '../../../../../math/src/float/bits.ts'
import { drawDistanceAt } from '../drawDistance.ts'

/** `tree`'s record table as the host writes it: its nodes, then its order. */
function treeTableOf(tree: PlacementTree) {
  const table = recordTable(TREE_TABLE, Math.max(1, treeNodeCount(tree))),
    words = new Uint32Array(tree.nodes.buffer, tree.nodes.byteOffset, tree.nodes.length)
  for (let n = 0; n < treeNodeCount(tree); n++)
    table.set('Node', n, words.subarray(n * DAG_NODE_FLOATS, (n + 1) * DAG_NODE_FLOATS))
  for (let r = 0; r * TREE_SPAN < tree.capacity; r++)
    table.set('Members', r, tree.order.subarray(r * TREE_SPAN, (r + 1) * TREE_SPAN))
  return { table, words }
}

/** Each placement's frame words the refit and the leaves read: its root, its mark, the distances it
 *  is drawn at, the node of the group above its root. */
const frameWords = (dag: PackedDag) =>
  Array.from({ length: dag.worldSources.length * FRAME_ROW_WORDS }, (_, k) => {
    const w = Math.floor(k / FRAME_ROW_WORDS),
      at = k % FRAME_ROW_WORDS
    if (at === ROOT_WORD) return dag.rootNodes[w]
    if (at === MARK_WORD) return dag.mark[w]
    if (at === PARENT_WORD) return dag.parentNode?.[w] ?? NO_INDEX
    const distance = drawDistanceAt(dag.drawDistance, w)
    if (at === DRAW_NEAR_WORD) return f32Bits(distance?.min ?? 0)
    return at === DRAW_FAR_WORD ? f32Bits(distance?.max ?? 0) : 0
  })

/** Every placement's leaf as the GPU writes it (`../../../placement/tree/treeLeavesWgsl.ts`, proven word
 *  for word in `treeLeavesWgsl.test.ts`): its root node's box grown by its reach, carried by its
 *  world, six numbers each; a parked placement's none (zeros): the refit passes over it. */
export function leafBoxes(dag: PackedDag) {
  const count = dag.worldSources.length,
    leaves = new Float64Array(count * 6),
    box = new Float64Array(12)
  for (let w = 0; w < count; w++) {
    if (dag.rootNodes[w] === NO_INDEX) continue
    const at = dag.rootBases[w] * DAG_NODE_FLOATS
    for (let a = 0; a < 3; a++) {
      box[a] = dag.nodes[at + NODE_MIN + a]
      box[3 + a] = dag.nodes[at + NODE_MAX + a]
    }
    const bits = dag.mark[w] >>> 16
    boxGrow(box, 6, box, 0, bits && bits < REACH_UNBOUNDED ? fromHalf(bits) : 0)
    boxTransform(leaves, w * 6, box, 6, dag.worldSources[w].world.elements)
  }
  return leaves
}

/** `dag`'s frame words as their record table holds them (`frameWords`). */
function frameTableOf(dag: PackedDag) {
  const count = dag.worldSources.length,
    table = recordTable(FRAME_TABLE, Math.max(1, count)),
    words = frameWords(dag)
  for (let w = 0; w < count; w++)
    table.set('Row', w, words.slice(w * FRAME_ROW_WORDS, (w + 1) * FRAME_ROW_WORDS))
  return table
}

/** The leaves the refit fits over as `members` holds them: the boxes (`leafBoxes`) alone, `PARENT_LEAF`
 *  doubles a placement, where no `parents` is given (a cut whose packing names no group above any
 *  root); else `LEAF_DOUBLES`, the parent leaf after each box — the words the leaves pass writes
 *  (`PARENT_LEAF`: the centre, the radius, the error, a one) of the placements `parents` names,
 *  zeros for any other. */
function memberLeaves(dag: PackedDag, parents?: (w: number) => readonly number[] | undefined) {
  const boxes = leafBoxes(dag),
    count = dag.worldSources.length,
    pairs: Pair[] = []
  const bits = new Uint32Array(1),
    floats = new Float32Array(bits.buffer)
  const word = (value: number) => ((floats[0] = value), bits[0])
  for (let w = 0; w < count; w++) {
    for (let k = 0; k < PARENT_LEAF; k++) pairs.push(pair(boxes[w * 6 + k]) as Pair)
    if (!parents) continue
    const leaf = parents(w)
    const [cx, cy, cz, radius, error] = leaf ?? [0, 0, 0, 0, 0]
    pairs.push([word(cx), word(cy)], [word(cz), word(radius)], [word(error), leaf ? 1 : 0])
  }
  return pairs
}

/** Fits `groups` of `dag`'s tree and every node above them, in `tree.nodes`; every group by default.
 *  The leaves are the GPU's from the packing as it stands (`leafBoxes`), the marks and parks the
 *  packing's, the parent leaves those `parents` names (`memberLeaves`), the narrow kernel's where
 *  none is given. Returns the nodes fitted. */
export function refitTree(
  dag: PackedDag,
  groups?: Iterable<number>,
  parents?: (w: number) => readonly number[] | undefined,
) {
  const tree = dag.placementTree as PlacementTree
  const { table, words } = treeTableOf(tree)
  const params = { first: 0, count: 0, base: 0, live: tree.count } as Record<string, number>
  const run = shaderRun<{ fitGroup(j: number): void; fitCell(j: number): void }>(
    TREE_REFIT_WGSL,
    [
      ...DOUBLE_HELPERS,
      ...['dLess', 'dMin', 'dMax', 'dAbs', 'toF32', 'fromF32'],
      ...['treeNode', 'treeNodeStore', 'treeMembers', 'treeWord', 'treeSetWord', 'treeMember'],
      ...['framesRow', 'framesWord', 'writeBox', 'fitGroup', 'fitCell'],
    ],
    {
      params,
      tree: table,
      frames: frameTableOf(dag),
      members: memberLeaves(dag, parents),
      [LEAF_STRIDE_CONSTANT]: leafStride(!!parents),
    },
  )
  const all = groups ?? Array.from({ length: tree.levels.at(-1)!.count }, (_, g) => g)
  let fitted = 0
  for (const { level, ids } of refitLevels(tree, all)) {
    const below = tree.levels[level + 1]
    Object.assign(params, {
      base: tree.levels[level].base,
      childBase: below?.base ?? 0,
      childCount: below?.count ?? 0,
    })
    for (const j of ids) {
      if (below) run.fitCell(j)
      else run.fitGroup(j)
      fitted++
    }
  }
  for (let n = 0; n < treeNodeCount(tree); n++) words.set(table.get('Node', n), n * DAG_NODE_FLOATS)
  return fitted
}

/** The change the refit proofs fit again, on `dag` packed from `roots`: poses a long way off, a
 *  park, a mark drawn whatever the view, a reach, a whole group parked. Returns the placements it touched. */
export function treeChange(dag: PackedDag, roots: readonly { world: { elements: unknown } }[]) {
  const tree = dag.placementTree!,
    touched = new Set<number>()
  const move = (w: number, x: number) => {
    ;(roots[w].world.elements as Float64Array)[12] += x
    touched.add(w)
  }
  for (const [w, x] of [
    [3, 4000],
    [70, -900],
    [4000, 50],
    [4001, 51],
    [9999, 1e5],
  ])
    move(w, x)
  dag.rootNodes[130] = NO_INDEX
  dag.mark[200] = SPRITE_UNCULLED
  mirrorKey(tree.always, 200, true)
  // A reach grows the leaf the GPU writes again.
  dag.mark[7000] = 5 << 16
  for (let k = 0; k < TREE_SPAN; k++) dag.rootNodes[tree.order[640 + k]] = NO_INDEX
  for (const w of [130, 200, 7000, tree.order[640]]) touched.add(w)
  return touched
}

/** The leaves the shipped leaves pass (`placement/tree/treeLeavesWgsl.ts`) writes over `roots`
 *  packed as `dag`, `LEAF_DOUBLES` doubles each, or the box's six where the cut is not `parented`:
 *  each placement's box and, after it, the ball and error of the group above its root. */
export function leavesWritten(dag: PackedDag, roots: readonly DagRoot[], parented = true) {
  const stride = leafStride(parented)
  const members: Pair[] = Array.from({ length: roots.length * stride }, () => [0, 0])
  // The cut's nodes as their record table holds them (`nodeTable.ts`).
  const count = dag.nodes.length / DAG_NODE_FLOATS,
    nodes = recordTable(NODE_TABLE, count),
    words = new Uint32Array(dag.nodes.buffer, dag.nodes.byteOffset, dag.nodes.length)
  for (let n = 0; n < count; n++)
    nodes.set('Node', n, words.subarray(n * DAG_NODE_FLOATS, (n + 1) * DAG_NODE_FLOATS))
  const run = shaderRun<{ writeLeaf(w: number): void }>(
    TREE_LEAVES_WGSL,
    [
      ...DOUBLE_HELPERS,
      ...['dLess', 'dMin', 'dMax', 'fromF32', 'carriedBox', 'nodesNode', 'nodesWord'],
      ...['framesRow', 'framesWord', 'markReach', 'reachUnbounded', 'writeLeaf'],
    ],
    {
      nodes,
      worlds: roots.flatMap(({ world }) => Array.from(world.elements, (v) => pair(v))),
      frames: frameTableOf(dag),
      members,
      [LEAF_STRIDE_CONSTANT]: stride,
    },
  )
  for (let w = 0; w < roots.length; w++) run.writeLeaf(w)
  return members
}

/** The parent leaf of placement `w` among the wide `members`: its ball's centre and radius, its
 *  error, whether it names a group. */
export function parentLeafOf(members: readonly Pair[], w: number) {
  const at = w * LEAF_DOUBLES + PARENT_LEAF
  return {
    centre: [members[at][0], members[at][1], members[at + 1][0]].map(fromF32Bits),
    radius: fromF32Bits(members[at + 1][1]),
    error: fromF32Bits(members[at + 2][0]),
    named: members[at + 2][1] === 1,
  }
}
