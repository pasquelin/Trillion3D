// The placement tree's descent and its depth: a view reads through it every placement the frustum
// may hold and no more as the world grows, the tree is ceil(log64 n) levels deep, and a growth's far
// batch fills groups of its own.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fieldCamera, fieldCut, placementField } from './placementTree.fixture.ts'
import { memberBox } from './placementTree.ts'
import { refitTree } from './treeRefitRun.fixture.ts'
import { packDagSelection } from './selection.ts'
import { appendDagRoots, dagRootCounts } from './pack.ts'
import { engineCamera } from '../../camera/camera.fixture.ts'
import { boxTransform, frustumExcludesBox } from '../../../../sdk-core/src/index.ts'

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
  for (let w = 80; w < 100; w++) memberBox(dag, dag.placementTree!, w)
  refitTree(dag)
  const at = fieldCamera([10_012, 30, 20], [10_012, 0, -12], 200)
  const seen = fieldCut([...near, ...far], at, true, dag).placements
  assert.ok(
    seen.length > 0 && seen.every((w) => w >= 80),
    `${seen.filter((w) => w < 80).length} near read`,
  )
})
