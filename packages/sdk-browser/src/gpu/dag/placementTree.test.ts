// The placement tree: cells and instance groups above the placements change no cut, and a
// frame reads the placements its kept groups hold, not the world's; a change refits what it moved.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fieldCamera, fieldCut, placementField } from './placementTree.fixture.ts'
import { refitPlacementTree } from './placementTree.ts'
import { packDagSelection } from './selection.ts'
import { appendDagRoots, dagRootCounts } from './pack.ts'
import { SELECTION_WORKGROUP } from '../core/selection.ts'
import { engineCamera } from '../../camera/camera.fixture.ts'
import { boxTransform, frustumExcludesBox } from '../../../../sdk-core/src/index.ts'
import { SPRITE_UNCULLED } from '../../visibility/shader/spriteWgsl.ts'

const views = [
  // Inside the field, looking along a row; from above its corner; past its edge, looking away.
  fieldCamera([30, 2, -30], [30, 0, -200]),
  fieldCamera([-10, 40, 10], [60, 0, -60]),
  fieldCamera([-50, 2, 50], [-200, 0, 200]),
]

test('the tree over a generated field changes no cut, whatever the view', () => {
  const roots = placementField(40, 6)
  for (const camera of views) {
    const tree = fieldCut(roots, camera, true),
      flat = fieldCut(roots, camera, false, tree.dag)
    assert.ok(tree.dag.placementTree, 'a field of 1600 placements takes a tree')
    assert.deepEqual(tree.pages, flat.pages)
    assert.deepEqual(tree.drawn, flat.drawn)
  }
})

test("a frame reads the placements its kept groups hold, never the world's", () => {
  // The same view over fields 4×, 16× and 64× as large: the placements read stay those of the
  // groups the view keeps, the cut the same, where the flat descent reads every placement.
  const camera = fieldCamera([30, 2, -30], [30, 0, -200], 120)
  const cuts = [40, 80, 160, 320].map((side) => {
    const roots = placementField(side, 6),
      tree = fieldCut(roots, camera, true)
    return { tree, flat: fieldCut(roots, camera, false, tree.dag), count: side * side }
  })
  for (const { tree, flat, count } of cuts) {
    assert.equal(flat.reached, count, 'without the tree every placement is prepared')
    assert.deepEqual(tree.drawn, flat.drawn, 'the same cut')
    assert.equal(tree.drawn.length, cuts[0].tree.drawn.length, 'the same view, the same pages')
    assert.ok(tree.reached <= 1.5 * cuts[0].tree.reached, `${tree.reached} read of ${count}`)
  }
  assert.ok(cuts[0].tree.reached < cuts[0].count / 2)
})

test('moving, parking or opening one placement refits its group and its cell, at any size', () => {
  for (const side of [40, 160]) {
    const roots = placementField(side, 6),
      { dag } = fieldCut(roots, views[0], true),
      tree = dag.placementTree!
    // A group bounds one workgroup's lanes of placements.
    const groupNode = tree.levels.at(-1)!.base + Math.floor(tree.slot[70] / SELECTION_WORKGROUP)
    const box = () => Array.from(dag.nodes.subarray(groupNode * 24, groupNode * 24 + 7))
    const before = box()
    // Placement 70 moves 1 km away: its group's box follows, and only a node per tree level is rewritten.
    ;(roots[70].world.elements as Float64Array)[12] = 1000
    assert.equal(refitPlacementTree(dag, tree, [70]).length, tree.depth)
    assert.ok(box()[4] >= 1000 && box()[4] > before[4])
    // Its cut is the flat one's at the new pose.
    const moved = fieldCut(roots, fieldCamera([990, 2, 0], [1000, 0, -50]), true, dag)
    assert.deepEqual(
      moved.pages,
      fieldCut(roots, fieldCamera([990, 2, 0], [1000, 0, -50]), false, dag).pages,
    )
    assert.ok(moved.pages.length > 0, 'the moved placement is drawn where it went')
    // Parked, its box no longer holds the far pose.
    dag.rootNodes[70] = 0xffffffff
    refitPlacementTree(dag, tree, [70])
    assert.ok(box()[4] < 1000)
    // Never culled, it opens its group.
    dag.rootNodes[70] = dag.rootBases[70]
    dag.mark[70] = SPRITE_UNCULLED
    refitPlacementTree(dag, tree, [70])
    assert.ok(box()[0] < -1e38 && box()[4] > 1e38)
  }
})

test('the descent reads through the tree every placement the frustum may hold, and no more as the world grows', () => {
  const camera = fieldCamera([30, 2, -30], [30, 0, -200], 120),
    { planes } = engineCamera(camera)
  const seen = [40, 160].map((side) => {
    const roots = placementField(side, 6),
      dag = packDagSelection(roots),
      visited = new Set(fieldCut(roots, camera, true, dag).placements)
    // Every placement whose world box meets the frustum is read.
    const box = new Float64Array(6)
    roots.forEach((root, w) => {
      const at = dag.rootBases[w] * 24
      box.set(dag.nodes.subarray(at, at + 3), 0)
      box.set(dag.nodes.subarray(at + 4, at + 7), 3)
      boxTransform(box, 0, box, 0, root.world.elements)
      if (!frustumExcludesBox(planes, box[0], box[1], box[2], box[3], box[4], box[5]))
        assert.ok(visited.has(w), `placement ${w} in view is read`)
    })
    return visited.size
  })
  assert.ok(seen[1] <= 1.5 * seen[0], `${seen.join(' → ')} read as the world grows ×16`)
  assert.ok(seen[0] < 1600 / 2)
})

test("a growth's placements join the tree in place, the cut the flat one's", () => {
  // A field of 100: 80 packed at a capacity of 160, then 20 appended, as a growth in place does.
  const roots = placementField(10, 6),
    counts = dagRootCounts(roots)
  const capacity = { pages: 2 * counts.pages, nodes: 2 * counts.nodes, worlds: 160 }
  const dag = packDagSelection(roots.slice(0, 80), capacity),
    tree = dag.placementTree!
  assert.ok(tree && tree.capacity === 160, 'the tree is laid out for the capacity')
  const added = appendDagRoots(dag, roots.slice(80))!
  assert.ok(added, 'a packing with a tree keeps room')
  // The batch fills new groups from the third: no group holds placements of two batches.
  assert.equal(tree.count, 128 + 20)
  for (let w = 0; w < 100; w++) assert.equal(tree.order[tree.slot[w]], w, `placement ${w}`)
  assert.deepEqual(added.tree.members, [128, 148])
  for (const camera of views) {
    const cut = fieldCut(roots, camera, true, dag)
    assert.deepEqual(cut.pages, fieldCut(roots, camera, false, dag).pages)
  }
  const seen = new Set(
    fieldCut(roots, fieldCamera([30, 40, 30], [30, 0, -30], 400), true, dag).placements,
  )
  assert.ok(
    [80, 90, 99].every((w) => seen.has(w)),
    'the appended are read through the tree',
  )
})

test('an open group opens every node above it, by its flag, its bounds past every plane', () => {
  const roots = placementField(40, 6)
  roots[70] = { ...roots[70], mark: SPRITE_UNCULLED }
  const dag = packDagSelection(roots),
    tree = dag.placementTree!,
    group = Math.floor(tree.slot[70] / SELECTION_WORKGROUP)
  const cell = tree.levels[0].base + Math.floor(group / SELECTION_WORKGROUP)
  for (const node of [tree.levels.at(-1)!.base + group, cell]) {
    assert.equal(tree.nodeOpen[node - tree.cellBase], 1)
    assert.deepEqual(
      Array.from(dag.nodes.subarray(node * 24, node * 24 + 7)).filter((_, a) => a !== 3),
      [-3.4e38, -3.4e38, -3.4e38, 3.4e38, 3.4e38, 3.4e38].map(Math.fround),
      `node ${node}: exactly the open bounds`,
    )
  }
})

test('the tree is ceil(log64 n) levels deep, its top one node: the descent opens on it alone', () => {
  for (const [side, depth] of [
    [10, 2],
    [64, 2],
    [71, 3],
  ]) {
    const dag = packDagSelection(placementField(side, 6)),
      tree = dag.placementTree!
    assert.equal(tree.depth, depth, `${side * side} placements`)
    assert.equal(tree.levels[0].count, 1, 'one top node')
    assert.equal(dag.levelSizes.length >= depth + 1, true, 'members below the tree')
  }
  // Its cut is the flat one's, three levels deep as two.
  const roots = placementField(71, 6),
    dag = packDagSelection(roots)
  const camera = fieldCamera([30, 2, -30], [30, 0, -200])
  assert.deepEqual(
    fieldCut(roots, camera, true, dag).pages,
    fieldCut(roots, camera, false, dag).pages,
  )
})

test("a growth's batch far from the packed placements fills its own groups: none spans the two", () => {
  // 80 placements near the origin, then 20 a growth brings ten kilometres off.
  const field = placementField(10, 6),
    near = field.slice(0, 80),
    far = field.slice(80)
  for (const root of far) (root.world.elements as Float64Array)[12] += 10_000
  const counts = dagRootCounts([...near, ...far])
  const capacity = { pages: 2 * counts.pages, nodes: 2 * counts.nodes, worlds: 160 }
  const dag = packDagSelection(near, capacity)
  assert.ok(appendDagRoots(dag, far))
  const at = fieldCamera([10_012, 30, 20], [10_012, 0, -12], 200)
  const seen = fieldCut([...near, ...far], at, true, dag).placements
  assert.ok(
    seen.length > 0 && seen.every((w) => w >= 80),
    `${seen.filter((w) => w < 80).length} near read`,
  )
})
