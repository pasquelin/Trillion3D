// The tree refit (`treeRefitWgsl.ts`, the shipped WGSL run in JavaScript): the groups a change touched
// and the nodes above them, fitted again, leave the tree as a fit of every group does — after poses
// moved a long way, parks, marks that open a group, a whole group parked —, nothing else read or
// written. The tree read and written in its record table (`treeTable.ts`), the frame words read in
// theirs (`../frameTable.ts`). The tree is the refit's alone:
// `packPlacementTree` leaves every node open.
import test from 'node:test'
import assert from 'node:assert/strict'
import { placementField } from '../placement/placementTree.fixture.ts'
import { packDagSelection } from '../pack/pack.ts'
import { treeNodeCount, TREE_SPAN } from '../placement/placementTree.ts'
import { leafBoxes, refitTree, treeChange } from './treeRefitRun.fixture.ts'
import { SPRITE_UNCULLED } from '../../../visibility/shader/spriteWgsl.ts'
import { DAG_NODE_FLOATS } from '../types.ts'
import { TREE_DRAW_FAR, TREE_DRAW_NEAR } from '../nodeLayout.ts'
import { fitDrawDistances, type DrawDistances } from '../oracle/nodeVerdict.fixture.ts'
import { NO_INDEX } from '../../../../../math/src/constants.ts'

test('the groups a change touched, and the nodes above them, are fitted as a fit of every group does', () => {
  const roots = placementField(100, 5),
    dag = packDagSelection(roots),
    tree = dag.placementTree!
  assert.equal(tree.levels.length, 3, 'a tree of three levels')
  const nodes = Array.from(dag.nodes)
  const words = () => new Uint32Array(tree.nodes.buffer, tree.nodes.byteOffset, tree.nodes.length)
  const first = 0,
    last = treeNodeCount(tree) * DAG_NODE_FLOATS
  // The first fit: every node, from the open tree the pack leaves.
  refitTree(dag)
  const held = Array.from(words())
  // The change: poses a long way off, a park, a mark drawn whatever the view, a reach, a whole group parked.
  const touched = treeChange(dag, roots)
  const groups = [...touched].map((w) => Math.floor(tree.slot[w] / TREE_SPAN))
  const fitted = refitTree(dag, groups)
  const incremental = Array.from(words())
  // Against every group fitted again from the same leaves, marks and parks.
  refitTree(dag)
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

test('a fitted group holds the draw distances of its placements: those they name, none where one is drawn at every distance', () => {
  const roots = placementField(80, 6)
  // Every placement names distances but the second group's first; the third group and the
  // seventy-first are parked whole, each a group with none to hold.
  roots.forEach((root, w) => (root.drawDistance = { min: 5 + (w % 11), max: 60 + (w % 17) * 9 }))
  const dag = packDagSelection(roots),
    tree = dag.placementTree!
  const groups = tree.levels.at(-1)!,
    member = (g: number, k: number) => tree.order[g * TREE_SPAN + k]
  assert.equal(tree.levels.length, 3, 'a tree of three levels')
  dag.drawDistance![2 * member(1, 0) + 1] = 0
  for (let k = 0; k < TREE_SPAN; k++)
    for (const g of [2, 70]) dag.rootNodes[member(g, k)] = NO_INDEX
  refitTree(dag)
  const stored = (n: number): DrawDistances => ({
    near: tree.nodes[n * DAG_NODE_FLOATS + TREE_DRAW_NEAR],
    far: tree.nodes[n * DAG_NODE_FLOATS + TREE_DRAW_FAR],
  })
  const namedBy = (w: number) => ({
    near: dag.drawDistance![2 * w],
    far: dag.drawDistance![2 * w + 1],
  })
  // A group over its placements still in the world.
  for (let g = 0; g < groups.count; g++) {
    const live = Array.from({ length: TREE_SPAN }, (_, k) => member(g, k)).filter(
      (w) => w !== NO_INDEX && dag.rootNodes[w] !== NO_INDEX,
    )
    assert.deepEqual(stored(groups.base + g), fitDrawDistances(live.map(namedBy)), `group ${g}`)
  }
  const none = { near: 0, far: 0 }
  assert.deepEqual(stored(groups.base + 1), none, 'one drawn at every distance')
  assert.deepEqual(stored(groups.base + 2), none, 'a group holding nothing')
  assert.deepEqual(stored(groups.base + 70), none)
  assert.ok(stored(groups.base).far > 0 && stored(groups.base + 3).far > 0, 'groups that name some')
  // A cell holds none, whatever its groups name.
  for (const level of [0, 1])
    for (let c = 0; c < tree.levels[level].count; c++)
      assert.deepEqual(stored(tree.levels[level].base + c), none, `cell ${c} of level ${level}`)
})
