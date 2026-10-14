// The tree refit (`treeRefitWgsl.ts`, the shipped WGSL run in JavaScript) over a packing's tables:
// the one fit a test has of the placement tree, there being no other (`packPlacementTree` leaves
// every node open), over the leaves the GPU writes from the packing as it stands (`leafBoxes`). The
// tree's record table and the frame words are held in words (`treeTable.ts`, `frameTable.ts`).
import { shaderRun } from '../../texture/shaderRun.fixture.ts'
import { REACH_UNBOUNDED, treeNodeCount, TREE_SPAN, type PlacementTree } from './placementTree.ts'
import { refitLevels } from './refitSchedule.ts'
import { boxTransform, boxGrow } from '../../../../math/src/geometry/box.ts'

import { fromHalf } from '../../../../math/src/float/half.ts'
import { NO_INDEX } from '../../../../math/src/constants.ts'
import { NODE_MAX, NODE_MIN } from './nodeLayout.ts'
import { SPRITE_UNCULLED } from '../../visibility/shader/spriteWgsl.ts'
import { mirrorKey } from '../../webgpu/cut/denseKeys.ts'
import { TREE_REFIT_WGSL } from './treeRefitWgsl.ts'
import { DOUBLE_HELPERS, pair, type Pair } from '../../placement/composeDoubles.fixture.ts'
import { DAG_NODE_FLOATS, FRAME_ROW_WORDS, type PackedDag } from './types.ts'
import { recordTable } from '../core/recordTexture.fixture.ts'
import { TREE_TABLE } from './treeTable.ts'
import { FRAME_TABLE, MARK_WORD, ROOT_WORD } from './frameTable.ts'

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

/** Each placement's frame words the refit reads: its root, its mark. */
const frameWords = (dag: PackedDag) =>
  Array.from({ length: dag.worldSources.length * FRAME_ROW_WORDS }, (_, k) => {
    const w = Math.floor(k / FRAME_ROW_WORDS),
      at = k % FRAME_ROW_WORDS
    return at === ROOT_WORD ? dag.rootNodes[w] : at === MARK_WORD ? dag.mark[w] : 0
  })

/** Every placement's leaf as the GPU writes it (`../../placement/treeLeavesWgsl.ts`, proven word
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
export function frameTableOf(dag: PackedDag) {
  const count = dag.worldSources.length,
    table = recordTable(FRAME_TABLE, Math.max(1, count)),
    words = frameWords(dag)
  for (let w = 0; w < count; w++)
    table.set('Row', w, words.slice(w * FRAME_ROW_WORDS, (w + 1) * FRAME_ROW_WORDS))
  return table
}

/** Fits `groups` of `dag`'s tree and every node above them, in `tree.nodes`; every group by default.
 *  The leaves are the GPU's from the packing as it stands (`leafBoxes`), the marks and parks the
 *  packing's. Returns the nodes fitted. */
export function refitTree(dag: PackedDag, groups?: Iterable<number>) {
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
      members: Array.from(leafBoxes(dag), (v) => pair(v) as Pair),
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
