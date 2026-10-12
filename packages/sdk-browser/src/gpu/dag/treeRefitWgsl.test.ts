// The tree refit (`treeRefitWgsl.ts`, the shipped WGSL run in JavaScript): the groups a change touched
// and the nodes above them, fitted again, leave the tree as a fit of every group does — after poses
// moved a long way, parks, marks that open a group, a whole group parked —, nothing else read or
// written. Tables whole, and split into parts and ranges as a small device lays them. The tree is
// the refit's alone: `packPlacementTree` leaves every node open.
import test from 'node:test'
import assert from 'node:assert/strict'
import { placementField } from './placementTree.fixture.ts'
import { packDagSelection } from './selection.ts'
import { memberBox, treeNodeCount, TREE_SPAN } from './placementTree.ts'
import { WHOLE_LAYOUT, type RefitLayout } from './treeRefitWgsl.ts'
import { refitTree } from './treeRefitRun.fixture.ts'
import { SPRITE_UNCULLED } from '../../visibility/shader/spriteWgsl.ts'
import { DAG_NODE_FLOATS } from './types.ts'

const NONE = 0xffffffff

/** The device that splits the nodes inside the tree's own range, the order in three, the frames in
 *  three ranges of placements. */
const split = (cellBase: number): RefitLayout => ({
  nodes: { per: cellBase + 60, parts: 3 },
  cold: { per: 4096, parts: 3 },
  frames: [0, 3000, 7000],
})

for (const name of ['whole', 'split across parts and ranges'] as const)
  test(`the groups a change touched, and the nodes above them, are fitted as a fit of every group does: tables ${name}`, () => {
    const roots = placementField(100, 5),
      dag = packDagSelection(roots),
      tree = dag.placementTree!
    const layout = name === 'whole' ? WHOLE_LAYOUT : split(tree.cellBase)
    assert.equal(tree.levels.length, 3, 'a tree of three levels')
    const words = () => new Uint32Array(dag.nodes.buffer, dag.nodes.byteOffset, dag.nodes.length)
    const first = tree.cellBase * DAG_NODE_FLOATS,
      last = (tree.cellBase + treeNodeCount(tree)) * DAG_NODE_FLOATS
    // The first fit: every node, from the open tree the pack leaves.
    refitTree(dag, undefined, layout)
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
    const groups = [...touched].map((w) => Math.floor(tree.slot[w] / TREE_SPAN))
    const fitted = refitTree(dag, groups, layout)
    const incremental = Array.from(words())
    // Against every group fitted again from the same leaves, marks and parks.
    refitTree(dag, undefined, layout)
    const full = Array.from(words())
    assert.deepEqual(
      incremental.slice(first, last),
      full.slice(first, last),
      'every node of the tree',
    )
    assert.ok(fitted < treeNodeCount(tree) / 4, `${fitted} of ${treeNodeCount(tree)} nodes fitted`)
    assert.notDeepEqual(
      incremental.slice(first, last),
      held.slice(first, last),
      'the change moved it',
    )
    assert.deepEqual(incremental.slice(0, first), held.slice(0, first), 'nodes outside the tree')
  })

test('a fitted tree holds every member, grown past the single-precision rounding, and opens where a member does', () => {
  const roots = placementField(40, 6),
    dag = packDagSelection(roots),
    tree = dag.placementTree!
  dag.mark[70] = SPRITE_UNCULLED
  refitTree(dag)
  const groups = tree.levels.at(-1)!,
    node = (n: number) => dag.nodes.subarray(n * DAG_NODE_FLOATS, n * DAG_NODE_FLOATS + 7)
  const opened = groups.base + Math.floor(tree.slot[70] / TREE_SPAN)
  assert.ok(node(opened)[0] < -1e38 && node(opened)[4] > 1e38, 'the group of an uncullable member')
  assert.ok(node(tree.levels[0].base)[0] < -1e38, 'and every node above it')
  for (const w of [0, 5, 1599]) {
    if (w === 70) continue
    const box = node(groups.base + Math.floor(tree.slot[w] / TREE_SPAN)),
      leaf = tree.boxes.subarray(w * 6, w * 6 + 6)
    for (let a = 0; a < 3; a++) {
      assert.ok(box[a] <= leaf[a] && box[4 + a] >= leaf[3 + a], `member ${w}, axis ${a}`)
    }
  }
})
