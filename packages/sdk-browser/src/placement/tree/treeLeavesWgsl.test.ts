// The placement tree's leaves the GPU writes (`treeLeavesWgsl.ts`, the shipped text run in
// JavaScript) are the CPU's formula to the word — the root node's box grown in its own space by the
// reach its mark carries, carried by the placement's double world, `boxTransform`'s order —, on a
// generated field posed by generated worlds: turns, uneven and negative scales, shears, far
// translations, marks with a reach and past every finite one, a parked placement. An instance of an
// assembly's leaf holds, beside its box, the ball and the error of the group above its root as the
// world carries them (`PARENT_LEAF`), grown past the rounding, never short of what the cut's own test
// would use (`placedScale`). A cut whose packing names no group above any root writes the box alone,
// its kernel made with the stride of the six.
import test from 'node:test'
import assert from 'node:assert/strict'
import { lcgRandom } from '../../../../math/src/sequence/random.ts'
import { placementField } from '../../geometry/dag/placement/placementTree.fixture.ts'
import { packDagSelection } from '../../geometry/dag/pack/pack.ts'
import {
  leafBoxes,
  leavesWritten,
  parentLeafOf,
} from '../../geometry/dag/tree/treeRefitRun.fixture.ts'
import {
  LEAF_DOUBLES,
  leafStride,
  PARENT_LEAF,
  REACH_UNBOUNDED,
} from '../../geometry/dag/placement/placementTree.ts'
import { generated, pair } from '../compose/composeDoubles.fixture.ts'

test('every leaf the GPU writes is the CPU formula’s, word for word', () => {
  const next = lcgRandom(41),
    roots = placementField(9, 6)
  for (const [w, root] of roots.entries())
    root.world = { elements: generated(next, [10, 1e4, 1e6][w % 3]) }
  const dag = packDagSelection(roots)
  dag.mark[3] = 0x3c00 << 16
  dag.mark[4] = 0x4a00 << 16
  dag.mark[5] = REACH_UNBOUNDED << 16
  dag.rootNodes[6] = 0xffffffff
  const expected = leafBoxes(dag)
  // Both widths: the boxes are the same words, wide or narrow.
  for (const parented of [true, false]) {
    const members = leavesWritten(dag, roots, parented),
      stride = leafStride(parented)
    assert.equal(members.length, roots.length * stride)
    for (let k = 0; k < expected.length; k++)
      assert.deepEqual(
        members[Math.floor(k / 6) * stride + (k % 6)],
        pair(expected[k]),
        `placement ${Math.floor(k / 6)}, bound ${k % 6}, ${stride} doubles`,
      )
    const parked = 6 * stride
    assert.deepEqual(
      members.slice(parked, parked + stride),
      Array(stride).fill([0, 0]),
      'a parked placement writes none',
    )
    if (parented)
      for (let w = 0; w < roots.length; w++)
        assert.equal(parentLeafOf(members, w).named, false, 'no instance names a group')
  }
})

test('a cut that names no group above any root writes no ball, whatever its roots say', () => {
  const roots = placementField(4, 6)
  roots[1].rootParent = { error: 3.5, sphere: [1, -2, 0.5, 8] }
  const dag = packDagSelection(roots)
  const narrow = leavesWritten(dag, roots, false),
    wide = leavesWritten(dag, roots, true)
  assert.equal(narrow.length, roots.length * PARENT_LEAF)
  assert.equal(parentLeafOf(wide, 1).named, true)
  // The narrow kernel wrote past the stride of six into no neighbour: every box is the wide one's.
  for (let w = 0; w < roots.length; w++)
    assert.deepEqual(
      narrow.slice(w * PARENT_LEAF, (w + 1) * PARENT_LEAF),
      wide.slice(w * LEAF_DOUBLES, w * LEAF_DOUBLES + PARENT_LEAF),
      `placement ${w}`,
    )
})

test('an instance’s leaf holds its group’s ball and error as its world carries them, grown past the rounding', () => {
  const next = lcgRandom(7),
    roots = placementField(4, 6)
  for (const [w, root] of roots.entries())
    root.world = { elements: generated(next, [10, 1e3, 1e5][w % 3]) }
  const group = { error: 3.5, sphere: [1, -2, 0.5, 8] } as const
  roots[0].rootParent = group
  roots[1].rootParent = { ...group }
  roots[2].rootParent = { error: 0, sphere: [0, 0, 0, 4] }
  roots[3].rootParent = { error: Infinity, sphere: [0, 0, 0, 4] }
  // A group whose error, at its world's scale, is past single precision.
  roots[4].rootParent = { error: 1e37, sphere: [0, 0, 0, 4] }
  roots[4].world = {
    elements: new Float64Array([1e3, 0, 0, 0, 0, 1e3, 0, 0, 0, 0, 1e3, 0, 0, 0, 0, 1]),
  }
  const dag = packDagSelection(roots),
    members = leavesWritten(dag, roots)
  for (let w = 0; w < roots.length; w++) {
    const leaf = parentLeafOf(members, w),
      parent = roots[w].rootParent
    const named = !!parent && w !== 3 && w !== 4
    assert.equal(leaf.named, named, `placement ${w}`)
    if (!named) {
      assert.deepEqual([...leaf.centre, leaf.radius, leaf.error], [0, 0, 0, 0, 0], `placement ${w}`)
      continue
    }
    // The ball in the world's doubles, its radius at the largest axis scale and its error at the
    // smallest — the scales the cut's own test takes (`placedScale`).
    const m = roots[w].world.elements,
      [x, y, z, r] = parent!.sphere,
      scale = [0, 4, 8].map((c) => Math.hypot(m[c], m[c + 1], m[c + 2]))
    const exact = [0, 1, 2].map((i) => m[i] * x + m[4 + i] * y + m[8 + i] * z + m[12 + i])
    const radius = r * Math.max(...scale),
      error = parent!.error * Math.min(...scale),
      far = Math.max(...exact.map(Math.abs)) + radius
    const off = Math.hypot(...exact.map((v, i) => leaf.centre[i] - v))
    assert.ok(off + radius <= leaf.radius, `placement ${w}: the ball holds the group's`)
    assert.ok(leaf.radius <= radius + 2 ** -12 * far, `placement ${w}: the ball is not loose`)
    assert.ok(leaf.error >= error, `placement ${w}: the error is not short`)
    assert.ok(leaf.error <= error * (1 + 2 ** -11), `placement ${w}: the error is not loose`)
  }
  assert.equal(dag.parentNode![0], dag.parentNode![1], 'one node holds the group both read')
})
