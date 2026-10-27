// The view a node is tested in (`vsmDescentBegin`), built once for the hooks that test it, and the
// guard of the floor the camera's cut and the shadow views share (`floorApplies`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { functionsOf, wgslConstants } from '../../../../materials/texture/shaderRule.fixture.ts'
import { shaderRun } from '../../../../materials/texture/shaderRun.fixture.ts'
import { vsmDescentWgsl } from './traversalWgsl.ts'
import { SUNS_LAYOUT } from '../layout.fixture.ts'

const DESCENT = vsmDescentWgsl(SUNS_LAYOUT)
const C = wgslConstants(DESCENT)

// A node is tested by several hooks in a row (the frustum, the subtree, the floor, the pyramid, the
// priority): the view of the running entry — its map's record, the node's box in it, its mip's lens —
// is built once for the node, by the level itself before its tests (`DescentShape.begin`), and its
// edge scales are projected once for the hooks that ask them.
test('the view of a node is built by the level before its tests, once', () => {
  const built = { records: 0, boxes: 0, lenses: 0, growth: -1 }
  let shut = false
  const { vsmDescentBegin, outsideFrustum } = shaderRun<{
    vsmDescentBegin(...a: unknown[]): void
    outsideFrustum(...a: unknown[]): boolean
  }>(DESCENT, ['vsmDescentBegin', 'outsideFrustum'], {
    ...C,
    descentView: 0,
    deformReach: 0.5,
    descentHeld: {},
    descentMap: () => 3,
    descentMip: () => 2,
    vsmHandleFromId: (id: number) => ({ id }),
    vsmProjectionOf: () => (built.records++, { lightViewToClip: 'projection', wpoThreshold: 4 }),
    vsmDescentGrowth: (_w: number, threshold: number) => threshold / 8,
    vsmDescentBoxOf: (...a: unknown[]) => (
      built.boxes++,
      (built.growth = a[4] as number),
      { box: true }
    ),
    vsmViewLens: () => (built.lenses++, { focal: 10 }),
    vsmDescentChannelMismatch: () => shut,
    vsmDescentBoxInMap: () => true,
    vsmDescentNotDrawn: () => false,
  })
  vsmDescentBegin(7, [0, 0, 0], [1, 1, 1])
  assert.deepEqual(
    built,
    { records: 1, boxes: 1, lenses: 1, growth: 0.5 },
    'one of each, the growth its map allows',
  )
  assert.equal(outsideFrustum(7, [0, 0, 0], [1, 1, 1]), false)
  assert.deepEqual([built.records, built.boxes, built.lenses], [1, 1, 1], 'the test builds none')
  // A placement in none of the light's channels builds nothing and is out of the view.
  shut = true
  vsmDescentBegin(8, [0, 0, 0], [1, 1, 1])
  assert.deepEqual([built.records, built.boxes, built.lenses], [1, 1, 1], 'shut: no view')
  assert.equal(outsideFrustum(8, [0, 0, 0], [1, 1, 1]), true)
})

test('the edge scales of a node are projected once for the hooks that ask them', () => {
  let projected = 0
  const { vsmDescentScales } = shaderRun<{ vsmDescentScales(...a: unknown[]): number[] }>(
    DESCENT,
    ['vsmDescentScales'],
    {
      ...C,
      framesStretchBits: () => 0x3f800000,
      vsmDescentBall: () => [0, 0, 0],
      vsmRenderEdgeScales: () => (projected++, [2, 3]),
      descentHeld: {
        scaled: false,
        scales: [0, 0],
        pd: { lightViewToClip: 'projection' },
        box: { shiftedToClip: 'clip' },
        lens: {},
      },
    },
  )
  const node = { sphere: [0, 0, 0, 1] }
  assert.deepEqual(vsmDescentScales(node, 7), [2, 3])
  assert.deepEqual(vsmDescentScales(node, 7), [2, 3])
  assert.equal(projected, 1)
})

// The level runs the shape's `begin` before the first test of a root, of a child and of a held item of
// the post pass, so that no hook reads a view of the node before it. A cell of the tree, which the post
// pass tests first, is no node of a placement: it reads no view of one.
test('the levels begin a node before they test it', () => {
  for (const [name, test] of [
    ['testRoot', 'outsideFrustum('],
    ['testNode', 'outsideFrustum('],
    ['postItem', 'boxSight(node.minimum'],
  ] as const) {
    const text = functionsOf(DESCENT, [name])
    const begin = text.indexOf('vsmDescentBegin(w,node.minimum,node.maximum);')
    assert.ok(begin >= 0 && begin < text.indexOf(test), name)
  }
})

// The guard of the floor is the camera's own (`floorApplies`, `floorWgsl.ts`): a leaf with a floor of some
// error, while the host has not turned the cull off.
test('a leaf with a floor can be dropped on it, an inner node or a leaf with none cannot', () => {
  const applies = (node: object, off = false) =>
    shaderRun<{ floorApplies(node: object): boolean }>(DESCENT, ['floorApplies'], {
      ...C,
      cullOff: (bit: number) => off && bit === C.CULL_MIN_LOD_OFF,
    }).floorApplies(node)
  const leaf = { childCount: 0, minError: 0.5 }
  assert.equal(applies(leaf), true)
  assert.equal(applies({ ...leaf, childCount: 2 }), false, 'an inner node')
  assert.equal(applies({ ...leaf, minError: 0 }), false, 'no floor')
  assert.equal(applies(leaf, true), false, 'the cull turned off')
})
