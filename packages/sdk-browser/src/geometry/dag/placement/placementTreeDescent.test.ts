// The placement tree's descent and its depth: a view reads through it every placement the frustum
// may hold and no more as the world grows, the tree is ceil(log64 n) levels deep, and a growth's far
// batch fills groups of its own.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fieldCamera, fieldCut, placementField } from './placementTree.fixture.ts'
import { refitTree } from '../tree/treeRefitRun.fixture.ts'
import { packDagSelection } from '../pack/pack.ts'
import { dagRootCounts } from '../pack/packCapacity.ts'
import { appendDagRoots } from '../pack/packAppend.ts'
import { engineCamera } from '../../../camera/camera.fixture.ts'
import { outsideRootDrawDistance } from '../oracle/nodeVerdict.fixture.ts'
import { boxTransform } from '../../../../../math/src/geometry/box.ts'
import { frustumExcludesBox } from '../../../../../math/src/geometry/frustum/box.ts'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import { Mat } from '../../../materials/texture/shaderRunMatrix.fixture.ts'
import { f32Bits } from '../../../../../math/src/float/bits.ts'
import { lcgRandom } from '../../../../../math/src/sequence/random.ts'
import { NO_INDEX } from '../../../../../math/src/constants.ts'
import { DAG_SELECTION_SHADER } from '../shader/selectionShader.fixture.ts'
import { OCCLUSION_TWO_PASS } from '../shader/occlusionWgsl.ts'
import { ROOT_PARENT_MARK } from '../frameTable.ts'
import { TREE_PARENT_ERROR, TREE_PARENT_SPHERE } from '../nodeLayout.ts'
import { DAG_NODE_FLOATS } from '../types.ts'
import { memberShift, TREE_SPAN } from './placementTree.ts'
import { cullingOf } from '../pack/packRoots.ts'
import { hierarchyLevelSizes } from '../hierarchy.ts'
import { leavesWritten, parentLeafOf } from '../tree/treeRefitRun.fixture.ts'

test('the descent reads through the tree every placement the frustum may hold within its draw distance, and no more as the world grows', () => {
  // A view has no far plane: each placement is drawn within 120 m of the eye, as an object names.
  const camera = fieldCamera([30, 2, -30], [30, 0, -200]),
    { planes } = engineCamera(camera)
  const seen = [40, 160].map((side) => {
    const roots = placementField(side, 6, 120),
      dag = packDagSelection(roots),
      visited = new Set(fieldCut(roots, camera, true, dag).placements)
    // Every placement whose world box meets the frustum, within its draw distance, is read.
    const box = new Float64Array(6)
    roots.forEach((root, w) => {
      const at = dag.rootBases[w] * 24
      box.set(dag.nodes.subarray(at, at + 3), 0)
      box.set(dag.nodes.subarray(at + 4, at + 7), 3)
      const local = [...box]
      boxTransform(box, 0, box, 0, root.world.elements)
      if (
        !frustumExcludesBox(planes, box[0], box[1], box[2], box[3], box[4], box[5]) &&
        !outsideRootDrawDistance(
          root.drawDistance,
          root.world.elements,
          camera.position.toArray(),
          local.slice(0, 3),
          local.slice(3),
        )
      )
        assert.ok(visited.has(w), `placement ${w} in view is read`)
    })
    return visited.size
  })
  assert.ok(seen[1] <= 1.5 * seen[0], `${seen.join(' → ')} read as the world grows ×16`)
  // The groups cull by distance conservatively (their box's half diagonal twice over), so a draw
  // distance of 120 m keeps the groups within about 190 m: 1088 of the 1600 placements of the small
  // world. The 25600 of the large one read no more than the small one holds.
  assert.ok(seen[1] < 1600)
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
    // The levels a member's root stands below the top, then its own hierarchy's: every level the
    // descent deposits at is one the kernel dispatches (`memberShift`, `../encode.ts`).
    const roots = placementField(side, 6),
      culling = cullingOf(roots[0]!)
    const member = hierarchyLevelSizes(culling.nodes, culling.stride).length
    assert.equal(dag.levelSizes.length, memberShift(tree) + member, 'members below the tree')
    const camera = fieldCamera([30, 2, -30], [30, 0, -200])
    const deepest = fieldCut(roots, camera, true, dag).levels.length - 1
    assert.ok(deepest < dag.levelSizes.length, `${side}: level ${deepest} is dispatched`)
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
  refitTree(dag)
  const at = fieldCamera([10_012, 30, 20], [10_012, 0, -12], 200)
  const seen = fieldCut([...near, ...far], at, true, dag).placements
  assert.ok(
    seen.length > 0 && seen.every((w) => w >= 80),
    `${seen.filter((w) => w < 80).length} near read`,
  )
})

/** The two verdicts on the group above an instance's root as the shipped kernel runs them in
 *  JavaScript: the instance's own (`outsideRootParent`, its ball and error in its part's space, read
 *  by its pose) and its group of the placement tree's (`outsideGroupRootParent`, the ball in the
 *  render frame's world and the error scaled to it). */
function parentKernel(pose: Mat, scale: number[], tree: Map<number, number>, node: number[]) {
  const view = {
    occlusion: OCCLUSION_TWO_PASS,
    cameraWorld: [0, 0, 0],
    view: new Mat([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
    pixelError: 1,
    pixelScale: [0, 1000],
    perspective: 1,
    near: 0.1,
  }
  const kernel = shaderRun<{
    outsideRootParent(w: number, mark: number): boolean
    outsideGroupRootParent(t: number): boolean
  }>(DAG_SELECTION_SHADER, ['outsideRootParent', 'outsideGroupRootParent'], {
    cutView: view,
    OCCLUSION_TWO_PASS,
    placedScale: scale,
    viewWorld: () => pose,
    framesWord: () => 1,
    nodesNode: () => node.slice(0, 4).map(f32Bits),
    nodesWord: () => f32Bits(node[4]),
    treeWord: (_: number, k: number) => tree.get(k) ?? 0,
  })
  return { view, ...kernel }
}

test('a group of the placement tree rejects only what none of its instances’ own tests keeps, a cut in one pass or a group that names none rejects nothing', () => {
  const next = lcgRandom(23),
    range = (low: number, high: number) => low + next() * (high - low)
  const pose = new Mat(Array(16).fill(0)),
    scale = [1, 1],
    tree = new Map<number, number>(),
    node = [0, 0, 0, 0, 0]
  const kernel = parentKernel(pose, scale, tree, node)
  let shown = 0,
    rejected = 0
  for (let n = 0; n < 4000; n++) {
    // Up to four instances, each at its own pose — a scale, a place before the eye — over one group.
    const lo = [Infinity, Infinity, Infinity],
      hi = [-Infinity, -Infinity, -Infinity]
    let error = 0,
      any = false
    for (let k = Math.ceil(range(0, 4)); k > 0; k--) {
      const s = range(0.2, 5),
        at = [range(-300, 300), range(-300, 300), -range(1, 30000)]
      pose.m.splice(0, 16, s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, ...at, 1)
      scale[0] = scale[1] = s
      const ball = [range(-3, 3), range(-3, 3), range(-3, 3), range(0.1, 8)]
      node.splice(0, 5, ...ball, range(0, 2) ** 2)
      if (!kernel.outsideRootParent(0, ROOT_PARENT_MARK)) any = true
      // The group's ball: the instances' balls in the world, its error theirs scaled to it.
      for (let a = 0; a < 3; a++) {
        const centre = s * ball[a] + at[a]
        lo[a] = Math.min(lo[a], centre - s * ball[3])
        hi[a] = Math.max(hi[a], centre + s * ball[3])
      }
      error = Math.max(error, s * node[4])
    }
    const margin = 1 + 2 ** -12,
      middle = lo.map((v, a) => 0.5 * (v + hi[a]))
    tree.set(TREE_PARENT_ERROR, f32Bits(error * margin))
    middle.forEach((v, a) => tree.set(TREE_PARENT_SPHERE + a, f32Bits(v)))
    tree.set(
      TREE_PARENT_SPHERE + 3,
      f32Bits(Math.hypot(...lo.map((v, a) => 0.5 * (hi[a] - v))) * margin),
    )
    const rejects = kernel.outsideGroupRootParent(5)
    // An instance that opens keeps its group: the group's ball holds the instance's, its error is
    // at least the instance's.
    if (any) assert.equal(rejects, false, `trial ${n}`)
    if (any) shown++
    else if (rejects) rejected++
  }
  assert.ok(
    shown > 400 && rejected > 400,
    `${shown} groups with an open instance, ${rejected} rejected`,
  )
  // Nothing rejected where the group names no error, or where one pass tests the placements alone.
  tree.set(TREE_PARENT_ERROR, f32Bits(-1))
  assert.equal(kernel.outsideGroupRootParent(5), false, 'a group that names none')
  tree.set(TREE_PARENT_ERROR, f32Bits(0.5))
  tree.set(TREE_PARENT_SPHERE + 3, f32Bits(1))
  tree.set(TREE_PARENT_SPHERE + 2, f32Bits(-1e6))
  assert.equal(kernel.outsideGroupRootParent(5), true, 'a far group, its error too small to show')
  kernel.view.occlusion = 0
  assert.equal(kernel.outsideGroupRootParent(5), false, 'a cut in one pass')
})

test('a group of instances at uneven scales, from their worlds through the leaves and the refit to the verdict, rejects only what none of them keeps', () => {
  const next = lcgRandom(61),
    range = (low: number, high: number) => low + next() * (high - low)
  const pose = new Mat(Array(16).fill(0)),
    scale = [1, 1],
    words = new Map<number, number>(),
    node = [0, 0, 0, 0, 0]
  const kernel = parentKernel(pose, scale, words, node)
  let kept = 0,
    rejected = 0
  for (let n = 0; n < 300; n++) {
    // A field of the tree's two groups, a few of its placements instances of an assembly, each at a
    // scale of its own on every axis, the others parked: the leaves pass, the refit and the kernel
    // run as shipped.
    const roots = placementField(9, 6),
      count = Math.ceil(range(0, 4))
    const poses = Array.from({ length: count }, () => {
      const w = Math.floor(range(0, roots.length)),
        axes = [range(0.2, 5), range(0.2, 5), range(0.2, 5)],
        at = [range(-300, 300), range(-300, 300), -range(1, 30000)]
      const ball = [range(-3, 3), range(-3, 3), range(-3, 3), range(0.1, 8)] as const
      roots[w].world = {
        elements: new Float64Array([
          axes[0],
          0,
          0,
          0,
          0,
          axes[1],
          0,
          0,
          0,
          0,
          axes[2],
          0,
          ...at,
          1,
        ]),
      }
      roots[w].rootParent = { error: range(0, 2) ** 2, sphere: ball }
      return { w, axes, at, parent: roots[w].rootParent }
    })
    const dag = packDagSelection(roots),
      named = new Set(poses.map(({ w }) => w))
    roots.forEach((_, w) => named.has(w) || (dag.rootNodes[w] = NO_INDEX))
    const leaves = leavesWritten(dag, roots)
    refitTree(dag, undefined, (w) => {
      const leaf = parentLeafOf(leaves, w)
      return leaf.named ? [...leaf.centre, leaf.radius, leaf.error] : undefined
    })
    const tree = dag.placementTree!,
      groups = new Set(poses.map(({ w }) => Math.floor(tree.slot[w] / TREE_SPAN)))
    for (const g of groups) {
      const at = (tree.levels.at(-1)!.base + g) * DAG_NODE_FLOATS
      for (const k of [TREE_PARENT_ERROR, ...[0, 1, 2, 3].map((a) => TREE_PARENT_SPHERE + a)])
        words.set(k, f32Bits(tree.nodes[at + k]))
      // Does an instance of this group open under its own test?
      let opens = false
      for (const { w, axes, at, parent } of poses) {
        if (Math.floor(tree.slot[w] / TREE_SPAN) !== g) continue
        pose.m.splice(0, 16, axes[0], 0, 0, 0, 0, axes[1], 0, 0, 0, 0, axes[2], 0, ...at, 1)
        scale[0] = Math.min(...axes)
        scale[1] = Math.max(...axes)
        node.splice(0, 5, ...parent.sphere, parent.error)
        if (!kernel.outsideRootParent(0, ROOT_PARENT_MARK)) opens = true
      }
      const rejects = kernel.outsideGroupRootParent(5)
      if (opens) assert.equal(rejects, false, `trial ${n}: an instance that opens keeps its group`)
      if (opens) kept++
      else if (rejects) rejected++
    }
  }
  assert.ok(
    kept > 30 && rejected > 30,
    `${kept} groups with an open instance, ${rejected} rejected`,
  )
})
