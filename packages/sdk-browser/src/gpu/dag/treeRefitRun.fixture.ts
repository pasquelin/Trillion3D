// The tree refit (`treeRefitWgsl.ts`, the shipped WGSL run in JavaScript) over a packing's tables:
// the one fit a test has of the placement tree, there being no other (`packPlacementTree` leaves
// every node open). The tree's record table is held in words (`treeTable.ts`), the frames in the
// ranges `layout` gives — one, or as a small device splits them.
import { shaderRun } from '../../texture/shaderRun.fixture.ts'
import {
  memberBox,
  refitLevels,
  treeNodeCount,
  TREE_SPAN,
  type PlacementTree,
} from './placementTree.ts'
import { SPRITE_UNCULLED } from '../../visibility/shader/spriteWgsl.ts'
import { mirrorKey } from '../../webgpu/cut/denseKeys.ts'
import { treeRefitWgsl, type RefitLayout } from './treeRefitWgsl.ts'
import {
  DOUBLE_HELPERS,
  countLeadingZeros,
  pair,
  type Pair,
} from '../../placement/composeDoubles.fixture.ts'
import { DAG_NODE_FLOATS, FRAME_ROW_WORDS, type PackedDag } from './types.ts'
import { recordTable } from '../core/recordTexture.fixture.ts'
import { TREE_TABLE } from './treeTable.ts'

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

/** Fits `groups` of `dag`'s tree and every node above them, in `tree.nodes`; every group by default.
 *  The leaves are `tree.boxes`, the marks and parks the packing's. Returns the nodes fitted. */
export function refitTree(dag: PackedDag, groups?: Iterable<number>, layout?: RefitLayout) {
  const tree = dag.placementTree as PlacementTree
  const count = dag.worldSources.length,
    ranges = layout?.frames ?? [0]
  const frames = Array.from({ length: count * FRAME_ROW_WORDS }, (_, k) => {
    const w = Math.floor(k / FRAME_ROW_WORDS),
      at = k % FRAME_ROW_WORDS
    return at === 1 ? dag.rootNodes[w] : at === 3 ? dag.mark[w] : 0
  })
  const { table, words } = treeTableOf(tree)
  const tables: Record<string, unknown> = { tree: table }
  ranges.forEach(
    (first, r) =>
      (tables[`frames${r}`] = frames.slice(
        first * FRAME_ROW_WORDS,
        (ranges[r + 1] ?? count) * FRAME_ROW_WORDS,
      )),
  )
  const params = { first: 0, count: 0, base: 0, live: tree.count } as Record<string, number>
  const run = shaderRun<{ fitGroup(j: number): void; fitCell(j: number): void }>(
    treeRefitWgsl(layout),
    [
      ...DOUBLE_HELPERS,
      ...['dLess', 'dMin', 'dMax', 'dAbs', 'toF32', 'fromF32'],
      ...['treeNode', 'treeNodeStore', 'treeMembers', 'treeWord', 'treeSetWord', 'treeMember'],
      ...['frameWord', 'writeBox', 'fitGroup', 'fitCell'],
    ],
    {
      countLeadingZeros,
      params,
      ...tables,
      members: Array.from({ length: count * 6 }, (_, k) => pair(tree.boxes[k]) as Pair),
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

/** No node: a parked root's. */
const NONE = 0xffffffff

/** The change the refit proofs fit again, on `dag` packed from `roots`: poses a long way off, a
 *  park, a mark drawn whatever the view, a reach, a whole group parked. Returns the placements it touched. */
export function treeChange(dag: PackedDag, roots: readonly { world: { elements: unknown } }[]) {
  const tree = dag.placementTree!,
    touched = new Set<number>()
  const move = (w: number, x: number) => {
    ;(roots[w].world.elements as Float64Array)[12] += x
    memberBox(dag, tree, w)
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
  dag.rootNodes[130] = NONE
  dag.mark[200] = SPRITE_UNCULLED
  mirrorKey(tree.always, 200, true)
  // A reach grows the leaf the follower takes again (`memberBox`).
  dag.mark[7000] = 5 << 16
  memberBox(dag, tree, 7000)
  for (let k = 0; k < TREE_SPAN; k++) dag.rootNodes[tree.order[640 + k]] = NONE
  for (const w of [130, 200, 7000, tree.order[640]]) touched.add(w)
  return touched
}
