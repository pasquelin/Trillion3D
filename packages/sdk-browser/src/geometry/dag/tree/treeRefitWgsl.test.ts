// The tree refit (`treeRefitWgsl.ts`, the shipped WGSL run in JavaScript): the groups a change touched
// and the nodes above them, fitted again, leave the tree as a fit of every group does — after poses
// moved a long way, parks, marks that open a group, a whole group parked —, nothing else read or
// written. The tree read and written in its record table (`treeTable.ts`), the frame words read in
// theirs (`../frameTable.ts`). The tree is the refit's alone:
// `packPlacementTree` leaves every node open. A group also holds the ball and the error its
// instances' parent groups are tested at: a ball about theirs, the greatest error, none (an error
// of -1) as soon as one live placement names no parent.
import test from 'node:test'
import assert from 'node:assert/strict'
import { placementField } from '../placement/placementTree.fixture.ts'
import { packDagSelection } from '../pack/pack.ts'
import { treeNodeCount, TREE_SPAN } from '../placement/placementTree.ts'
import { leafBoxes, refitTree, treeChange } from './treeRefitRun.fixture.ts'
import { SPRITE_UNCULLED } from '../../../visibility/shader/spriteWgsl.ts'
import { DAG_NODE_FLOATS } from '../types.ts'
import {
  TREE_DRAW_FAR,
  TREE_DRAW_NEAR,
  TREE_PARENT_ERROR,
  TREE_PARENT_SPHERE,
} from '../nodeLayout.ts'
import { fitDrawDistances, type DrawDistances } from '../oracle/nodeVerdict.fixture.ts'
import { drawDistanceAt, writeDrawDistanceAt } from '../drawDistance.ts'
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
  roots.forEach(
    (root, w) =>
      (root.drawDistance = { min: 5 + (w % 11), max: 60 + (w % 17) * 9, perInstance: w % 3 === 0 }),
  )
  const dag = packDagSelection(roots),
    tree = dag.placementTree!
  const groups = tree.levels.at(-1)!,
    member = (g: number, k: number) => tree.order[g * TREE_SPAN + k]
  assert.equal(tree.levels.length, 3, 'a tree of three levels')
  writeDrawDistanceAt(dag.drawDistance!, member(1, 0), undefined)
  // A nearest alone is no farthest: its group names none either, whatever the others name.
  writeDrawDistanceAt(dag.drawDistance!, member(4, 0), { min: 9, max: 0, perInstance: false })
  for (let k = 0; k < TREE_SPAN; k++)
    for (const g of [2, 70]) dag.rootNodes[member(g, k)] = NO_INDEX
  refitTree(dag)
  const stored = (n: number): DrawDistances => ({
    near: tree.nodes[n * DAG_NODE_FLOATS + TREE_DRAW_NEAR],
    far: tree.nodes[n * DAG_NODE_FLOATS + TREE_DRAW_FAR],
  })
  const namedBy = (w: number) => ({
    near: drawDistanceAt(dag.drawDistance, w)?.min ?? 0,
    far: drawDistanceAt(dag.drawDistance, w)?.max ?? 0,
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
  assert.deepEqual(stored(groups.base + 4), none, 'one that names a nearest alone')
  assert.deepEqual(stored(groups.base + 2), none, 'a group holding nothing')
  assert.deepEqual(stored(groups.base + 70), none)
  assert.ok(stored(groups.base).far > 0 && stored(groups.base + 3).far > 0, 'groups that name some')
  // A cell holds none, whatever its groups name.
  for (const level of [0, 1])
    for (let c = 0; c < tree.levels[level].count; c++)
      assert.deepEqual(stored(tree.levels[level].base + c), none, `cell ${c} of level ${level}`)
})

test('a fitted group holds a ball about its placements’ parent balls and the greatest of their errors, none where one live placement names none', () => {
  const roots = placementField(80, 6),
    dag = packDagSelection(roots),
    tree = dag.placementTree!,
    groups = tree.levels.at(-1)!
  const member = (g: number, k: number) => tree.order[g * TREE_SPAN + k]
  // The parent leaf of a placement (`PARENT_LEAF`): a centre, a radius, an error.
  const leaf = (w: number) => [(w % 7) * 3, -(w % 5) * 2, (w % 3) * 4, 1 + (w % 9), 2 + (w % 13)]
  // The first group names one for all but its last member and the fifth for all but its first; the
  // fourth parks the one member that names none, which no fit reads; the third is parked whole.
  const unnamed = new Set([member(0, TREE_SPAN - 1), member(4, 0), member(3, 5)])
  for (let k = 0; k < TREE_SPAN; k++) dag.rootNodes[member(2, k)] = NO_INDEX
  dag.rootNodes[member(3, 5)] = NO_INDEX
  const parents = (w: number) => (unnamed.has(w) ? undefined : leaf(w))
  refitTree(dag, undefined, parents)
  const stored = (n: number) => ({
    error: tree.nodes[n * DAG_NODE_FLOATS + TREE_PARENT_ERROR],
    ball: Array.from(
      tree.nodes.subarray(
        n * DAG_NODE_FLOATS + TREE_PARENT_SPHERE,
        n * DAG_NODE_FLOATS + TREE_PARENT_SPHERE + 4,
      ),
    ),
  })
  const live = (g: number) =>
    Array.from({ length: TREE_SPAN }, (_, k) => member(g, k)).filter(
      (w) => w !== NO_INDEX && dag.rootNodes[w] !== NO_INDEX,
    )
  for (const g of [1, 3, 5, 70]) {
    const { error, ball } = stored(groups.base + g),
      ranks = live(g)
    const greatest = Math.max(...ranks.map((w) => leaf(w)[4]))
    assert.ok(error >= greatest && error <= greatest * (1 + 2 ** -11), `group ${g}: the error`)
    for (const w of ranks) {
      const [x, y, z, radius] = leaf(w)
      const off = Math.hypot(ball[0] - x, ball[1] - y, ball[2] - z)
      assert.ok(off + radius <= ball[3], `group ${g}, placement ${w}: the ball holds theirs`)
    }
    assert.ok(ball[3] > 0, `group ${g}`)
  }
  const none = { error: -1, ball: [0, 0, 0, 0] }
  assert.deepEqual(stored(groups.base), none, 'one live placement names none')
  assert.deepEqual(stored(groups.base + 4), none, 'the first of the group names none')
  assert.deepEqual(stored(groups.base + 2), none, 'a group holding nothing')
  // A cell tests none: its error stays -1 whatever its groups hold.
  for (const level of [0, 1])
    for (let c = 0; c < tree.levels[level].count; c++)
      assert.equal(stored(tree.levels[level].base + c).error, -1, `cell ${c} of level ${level}`)
})

test('a cut whose leaves are narrow fits the same boxes and distances, and writes no parent word', () => {
  const roots = placementField(80, 6)
  roots.forEach(
    (root, w) =>
      (root.drawDistance = { min: 5 + (w % 11), max: 60 + (w % 17) * 9, perInstance: false }),
  )
  const [wide, narrow] = [packDagSelection(roots), packDagSelection(roots)]
  for (const dag of [wide, narrow]) {
    const tree = dag.placementTree!
    for (let k = 0; k < TREE_SPAN; k++) dag.rootNodes[tree.order[2 * TREE_SPAN + k]] = NO_INDEX
  }
  // Every placement names a group in the wide cut, none in the narrow one: the leaves are as wide.
  refitTree(wide, undefined, (w) => [w % 7, 0, 0, 1, 2])
  refitTree(narrow)
  const [a, b] = [wide, narrow].map((dag) => {
    const count = dag.placementTree!.nodes.length / DAG_NODE_FLOATS
    return Array.from({ length: count }, (_, n) =>
      Array.from(dag.placementTree!.nodes.subarray(n * DAG_NODE_FLOATS, (n + 1) * DAG_NODE_FLOATS)),
    )
  })
  const parentWords = new Set<number>([
    TREE_PARENT_ERROR,
    ...[0, 1, 2, 3].map((k) => TREE_PARENT_SPHERE + k),
  ])
  const without = (nodes: number[][]) => nodes.map((n) => n.filter((_, k) => !parentWords.has(k)))
  assert.deepEqual(without(b), without(a), 'boxes, distances and links')
  const tree = narrow.placementTree!
  for (let g = 0; g < tree.levels.at(-1)!.count; g++) {
    const node = b[tree.levels.at(-1)!.base + g]
    assert.equal(node[TREE_PARENT_ERROR], -1, `group ${g}`)
    assert.deepEqual(
      node.slice(TREE_PARENT_SPHERE, TREE_PARENT_SPHERE + 4).map(Math.abs),
      [0, 0, 0, 0],
    )
  }
  assert.ok(a[tree.levels.at(-1)!.base][TREE_PARENT_ERROR] > 0, 'the wide cut named one')
})
