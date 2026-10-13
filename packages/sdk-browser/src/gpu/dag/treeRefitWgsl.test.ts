// The tree refit (`treeRefitWgsl.ts`, the shipped WGSL run in JavaScript): the groups a change touched
// and the nodes above them, fitted again, leave the tree as a fit of every group does — after poses
// moved a long way, parks, marks that open a group, a whole group parked —, nothing else read or
// written. The tree read and written in its record table (`treeTable.ts`); the frames in one range,
// and in the ranges a small device splits them in. The tree is the refit's alone:
// `packPlacementTree` leaves every node open.
import test from 'node:test'
import assert from 'node:assert/strict'
import { placementField } from './placementTree.fixture.ts'
import { packDagSelection } from './selection.ts'
import { treeNodeCount, TREE_SPAN } from './placementTree.ts'
import { type RefitLayout } from './treeRefitWgsl.ts'
import { leafBoxes, refitTree, treeChange } from './treeRefitRun.fixture.ts'
import { SPRITE_UNCULLED } from '../../visibility/shader/spriteWgsl.ts'
import { DAG_NODE_FLOATS } from './types.ts'

/** The frames in three ranges of placements, as a small device splits them. */
const SPLIT: RefitLayout = { frames: [0, 3000, 7000] }

for (const name of ['in one range', 'in three ranges'] as const)
  test(`the groups a change touched, and the nodes above them, are fitted as a fit of every group does: frames ${name}`, () => {
    const roots = placementField(100, 5),
      dag = packDagSelection(roots),
      tree = dag.placementTree!
    const layout = name === 'in one range' ? undefined : SPLIT
    assert.equal(tree.levels.length, 3, 'a tree of three levels')
    const nodes = Array.from(dag.nodes)
    const words = () => new Uint32Array(tree.nodes.buffer, tree.nodes.byteOffset, tree.nodes.length)
    const first = 0,
      last = treeNodeCount(tree) * DAG_NODE_FLOATS
    // The first fit: every node, from the open tree the pack leaves.
    refitTree(dag, undefined, layout)
    const held = Array.from(words())
    // The change: poses a long way off, a park, a mark drawn whatever the view, a reach, a whole group parked.
    const touched = treeChange(dag, roots)
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
    assert.deepEqual(Array.from(dag.nodes), nodes, 'no node outside the tree')
  })

test('a fitted tree holds every member, grown past the single-precision rounding, finite where a member is never culled', () => {
  const roots = placementField(40, 6),
    dag = packDagSelection(roots),
    tree = dag.placementTree!
  dag.mark[70] = SPRITE_UNCULLED
  refitTree(dag)
  const groups = tree.levels.at(-1)!,
    node = (n: number) => tree.nodes.subarray(n * DAG_NODE_FLOATS, n * DAG_NODE_FLOATS + 7)
  const held = groups.base + Math.floor(tree.slot[70] / TREE_SPAN)
  assert.ok(node(held)[0] > -1e38 && node(held)[4] < 1e38, 'the group of an uncullable member')
  assert.ok(node(tree.levels[0].base)[0] > -1e38, 'and every node above it')
  const leaves = leafBoxes(dag)
  for (const w of [0, 5, 70, 1599]) {
    const box = node(groups.base + Math.floor(tree.slot[w] / TREE_SPAN)),
      leaf = leaves.subarray(w * 6, w * 6 + 6)
    for (let a = 0; a < 3; a++) {
      assert.ok(box[a] <= leaf[a] && box[4 + a] >= leaf[3 + a], `member ${w}, axis ${a}`)
    }
  }
})
