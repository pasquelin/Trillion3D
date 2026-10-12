// The tree refit (`treeRefitWgsl.ts`, the shipped WGSL run in JavaScript) leaves the tree's nodes as
// the CPU build fits them (`fitPlacementTree`): word for word, after poses moved a long way, parks,
// marks that open a group, a whole group parked — the groups the change touched fit again, and the
// nodes above them, nothing else read or written.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../texture/shaderRun.fixture.ts'
import { placementField } from './placementTree.fixture.ts'
import { packDagSelection } from './selection.ts'
import {
  memberBox,
  packPlacementTree,
  refitLevels,
  treeNodeCount,
  TREE_SPAN,
} from './placementTree.ts'
import { treeRefitWgsl, WHOLE_LAYOUT, type RefitLayout } from './treeRefitWgsl.ts'
import {
  DOUBLE_HELPERS,
  countLeadingZeros,
  pair,
  type Pair,
} from '../../placement/composeDoubles.fixture.ts'
import { SPRITE_UNCULLED } from '../../visibility/shader/spriteWgsl.ts'
import { DAG_NODE_FLOATS, FRAME_ROW_WORDS } from './types.ts'

const NONE = 0xffffffff

/** `words` laid out as the layout says: the parts of `per` records of `width` words each. */
function inParts(words: number[], per: number, parts: number, width: number) {
  return Array.from({ length: parts }, (_, p) =>
    words.slice(p * per * width, parts - 1 === p ? undefined : (p + 1) * per * width),
  )
}

/** The device that splits the nodes inside the tree's own range, the order in three, the frames in
 *  three ranges of placements. */
const split = (cellBase: number): RefitLayout => ({
  nodes: { per: cellBase + 60, parts: 3 },
  cold: { per: 4096, parts: 3 },
  frames: [0, 3000, 7000],
})

for (const name of ['whole', 'split across parts and ranges'] as const)
  test(`the groups a change touched, and the nodes above them, are fitted as the build fits them: tables ${name}`, () => {
    const roots = placementField(100, 5),
      dag = packDagSelection(roots),
      tree = dag.placementTree!
    const layout = name === 'whole' ? WHOLE_LAYOUT : split(tree.cellBase)
    assert.equal(tree.levels.length, 3, 'a tree of three levels')
    const words = () => new Uint32Array(dag.nodes.buffer, dag.nodes.byteOffset, dag.nodes.length)
    const first = tree.cellBase * DAG_NODE_FLOATS,
      last = (tree.cellBase + treeNodeCount(tree)) * DAG_NODE_FLOATS
    const held = Array.from(words())
    // The change: poses a long way off, a park, a mark that opens, a whole group parked.
    const touched = new Set<number>()
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
    dag.mark[7000] = 5 << 16
    for (let k = 0; k < TREE_SPAN; k++) dag.rootNodes[tree.order[640 + k]] = NONE
    for (const w of [130, 200, 7000, tree.order[640]]) touched.add(w)
    packPlacementTree(dag, tree)
    const expected = Array.from(words())
    // The GPU's tables as the change leaves them: the held nodes, the leaves, the frames, the order.
    const nodes = held.slice()
    const frames = Array.from({ length: roots.length * FRAME_ROW_WORDS }, (_, k) => {
      const w = Math.floor(k / FRAME_ROW_WORDS),
        at = k % FRAME_ROW_WORDS
      return at === 1 ? dag.rootNodes[w] : at === 3 ? dag.mark[w] : 0
    })
    const cold: number[] = []
    for (let k = 0; k < tree.capacity; k++) cold[tree.members + k] = tree.order[k]
    // The tables as the layout lays them: the parts, and a buffer a range of placements.
    const nodeParts = inParts(nodes, layout.nodes.per, layout.nodes.parts, DAG_NODE_FLOATS)
    const coldParts = inParts(cold, layout.cold.per, layout.cold.parts, 1)
    const ranges = layout.frames.map((first, r) =>
      frames.slice(
        first * FRAME_ROW_WORDS,
        (layout.frames[r + 1] ?? roots.length) * FRAME_ROW_WORDS,
      ),
    )
    const tables: Record<string, unknown> = {}
    nodeParts.forEach((part, k) => (tables[k ? `nodes${k}` : 'nodes'] = part))
    coldParts.forEach((part, k) => (tables[k ? `cold${k}` : 'cold'] = part))
    ranges.forEach((part, r) => (tables[`frames${r}`] = part))
    const params = {
      first: 0,
      count: 0,
      base: 0,
      live: tree.count,
      members: tree.members,
    } as Record<string, number>
    const run = shaderRun<{ fitGroup(j: number): void; fitCell(j: number): void }>(
      treeRefitWgsl(layout),
      [
        ...DOUBLE_HELPERS,
        'dLess',
        'dMin',
        'dMax',
        'dAbs',
        'toF32',
        'fromF32',
        'nodeWord',
        'setNodeWord',
        'coldAt',
        'frameWord',
        'writeBox',
        'fitGroup',
        'fitCell',
      ],
      {
        countLeadingZeros,
        params,
        ...tables,
        members: Array.from({ length: roots.length * 6 }, (_, k) => pair(tree.boxes[k]) as Pair),
      },
    )
    const groups = [...touched].map((w) => Math.floor(tree.slot[w] / TREE_SPAN))
    let fitted = 0
    for (const { level, ids } of refitLevels(tree, groups)) {
      const below = tree.levels[level + 1]
      Object.assign(params, {
        base: tree.levels[level].base,
        childBase: below?.base ?? 0,
        childCount: below?.count ?? 0,
      })
      for (const j of ids) {
        ;(below ? run.fitCell : run.fitGroup)(j)
        fitted++
      }
    }
    const result = nodeParts.flat()
    assert.deepEqual(
      result.slice(first, last).map((w) => w >>> 0),
      expected.slice(first, last),
      'every node of the tree',
    )
    assert.ok(fitted < treeNodeCount(tree) / 4, `${fitted} of ${treeNodeCount(tree)} nodes fitted`)
    // The nodes outside the tree are never touched.
    assert.deepEqual(result.slice(0, first), held.slice(0, first))
  })
