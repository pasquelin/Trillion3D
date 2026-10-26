// The frustum test of the DAG kernel tests the six planes of the view, a perspective view's far plane
// being the plane every box passes (`frustum.ts`: no far plane, as the reference has none), and the
// order a view's filter (`viewFilterWgsl.ts`) takes among the descent's tests, as the shipped kernel
// runs it in JavaScript over tests that each cull in turn: a test that culls ends the step, the
// tests after it never run; its clip plane has its own file (`clipPlaneCull.test.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { DAG_SELECTION_SHADER } from './selectionShader.fixture.ts'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import { lcgRandom } from '../../../../../math/src/sequence/random.ts'
import { cameraSelectionUniforms } from '../../../gpu/core/selection.ts'
import { createEngineCamera, writeEngineCamera } from '../../../camera/engineCamera.ts'
import { frustumExcludesBox } from '../../../../../math/src/geometry/frustum/box.ts'
import { frustumPlanesToLocal } from '../oracle/math.fixture.ts'

/** The planes a camera sends the kernel, `far` given. */
function cameraPlanes(far: number) {
  const cam = createEngineCamera()
  cam.world.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 3, 4, 5, 1])
  writeEngineCamera(cam, { fov: 60, aspect: 16 / 9, near: 0.1, far, zoom: 1 })
  return Float64Array.from(cameraSelectionUniforms(cam, 1, [1280, 720]).planes)
}

test('the kernel tests all six planes, and a perspective camera’s far plane is the one every box passes, whatever its declared far', () => {
  assert.ok(DAG_SELECTION_SHADER.includes('if(boxBehindPlane('))
  assert.ok(!DAG_SELECTION_SHADER.includes('farSkip'))
  for (const far of [Infinity, 2000])
    assert.deepEqual([...cameraPlanes(far).slice(16, 20)], [0, 0, 0, 1], `far ${far}`)
})

test('testing that plane keeps every box verdict of the five others, in any primitive space', () => {
  const planes = cameraPlanes(Infinity)
  // The same planes with the far one replaced by a copy of another: the five-plane verdict.
  const five = planes.slice()
  five.set(planes.subarray(0, 4), 16)
  const next = lcgRandom(2222),
    local = new Float64Array(24),
    localFive = new Float64Array(24)
  const worlds = [
    [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    [0, 2, 0, 0, -2, 0, 0, 0, 0, 0, 2, 0, 5, -3, 7, 1],
  ]
  for (const world of worlds) {
    frustumPlanesToLocal(local, planes, world)
    frustumPlanesToLocal(localFive, five, world)
    assert.deepEqual(
      [...local.slice(16, 20)],
      [0, 0, 0, 1],
      'unchanged through the primitive product',
    )
    for (let n = 0; n < 5000; n++) {
      const c = [0, 1, 2].map(() => (next() - 0.5) * 2e4),
        h = [0, 1, 2].map(() => next() * 10 ** (next() * 4))
      const box = [c[0] - h[0], c[1] - h[1], c[2] - h[2], c[0] + h[0], c[1] + h[1], c[2] + h[2]]
      assert.equal(
        frustumExcludesBox(local, ...(box as [number, number, number, number, number, number])),
        frustumExcludesBox(localFive, ...(box as [number, number, number, number, number, number])),
      )
    }
  }
})

/** The descent's steps — a placement's root, a node of its hierarchy, a cell or group of the tree
 *  — as the shipped kernel runs them over stubs: each test it makes is named in `calls` when it
 *  runs, and culls when it is the one `culled` names; what a step keeps is named in `kept`. */
function descent(culled?: string) {
  const calls: string[] = [],
    kept: string[] = []
  const culls = (name: string) => () => (calls.push(name), name === culled)
  const node = { minimum: [0, 0, 0], maximum: [1, 1, 1], childCount: 0 }
  const run = shaderRun<{
    testRoot(dst: number, w: number): void
    testNode(dst: number, c: number, w: number): boolean
    testCell(dst: number, t: number): void
    postItem(index: number, w: number): void
  }>(DAG_SELECTION_SHADER, ['testRoot', 'testNode', 'testCell', 'postItem'], {
    ...{ FINITE_SENTINEL: 1e30, BOX_SEEN: 1, BOX_OCCLUDED: 2, deformReach: 0 },
    ...{ out: { frustumRejected: 0, postHidden: 0 }, atomicAdd: () => 0 },
    // A placement's root.
    ...{ filteredOut: culls('filter'), rootOf: () => 0, nodeAt: () => node, markOf: () => 0 },
    ...{ markReach: () => 0, outsideDrawDistance: culls('distance') },
    ...{ outsideRootParent: culls('parent'), outsideClipPlane: culls('plane') },
    ...{ outsideFrustum: culls('frustum'), sightOf: () => 1 },
    ...{ acceptNode: () => kept.push('accepted'), postNode: () => 0 },
    // A node below it.
    ...{ worldNodeHides: () => false, viewWorld: () => 0, sphereEdges: () => [1, 1] },
    ...{ subtreeNeeded: () => true, floorPrunes: () => false, openOf: () => 0 },
    ...{ heldBack: () => false, reachOf: () => 0 },
    // A cell or group of the tree.
    ...{ cellLow: () => [0, 0, 0], cellHigh: () => [1, 1, 1], treeEntry: (t: number) => t },
    ...{ outsideGroupDrawDistance: culls('distance'), outsideGroupRootParent: culls('parent') },
    ...{ outsideGroupClipPlane: culls('plane'), outsideView: culls('frustum') },
    ...{ boxSight: () => 1, queueAppend: () => kept.push('queued') },
    ...{ cutView: { cellBase: 100 }, hasTree: () => true },
  })
  return { run, calls, kept }
}

test('a placement’s root is tested by the view’s filter first, its distance, its group above its root, its plane, then its frustum: the first to cull ends the step', () => {
  const order = ['filter', 'distance', 'parent', 'plane', 'frustum']
  for (const [at, culled] of order.entries()) {
    const { run, calls, kept } = descent(culled)
    run.testRoot(0, 0)
    assert.deepEqual(calls, order.slice(0, at + 1), `${culled} culls`)
    assert.deepEqual(kept, [], `${culled} culls`)
  }
  const { run, calls, kept } = descent()
  run.testRoot(0, 0)
  assert.deepEqual(calls, order)
  assert.deepEqual(kept, ['accepted'])
})

test('a group of the tree is tested by its distances, the parent groups of its instances, its plane, then its frustum', () => {
  const order = ['distance', 'parent', 'plane', 'frustum']
  for (const [at, culled] of order.entries()) {
    const { run, calls, kept } = descent(culled)
    run.testCell(0, 3)
    assert.deepEqual(calls, order.slice(0, at + 1), `${culled} culls`)
    assert.deepEqual(kept, [], `${culled} culls`)
  }
  const { run, calls, kept } = descent()
  run.testCell(0, 3)
  assert.deepEqual(calls, order)
  assert.deepEqual(kept, ['queued'])
})

test('a node below a root is tested by its plane, then its frustum', () => {
  for (const [at, culled] of ['plane', 'frustum'].entries()) {
    const { run, calls, kept } = descent(culled)
    assert.equal(run.testNode(0, 5, 0), false)
    assert.deepEqual(calls, ['plane', 'frustum'].slice(0, at + 1), `${culled} culls`)
    assert.deepEqual(kept, [], `${culled} culls`)
  }
  const { run, calls, kept } = descent()
  run.testNode(0, 5, 0)
  assert.deepEqual(calls, ['plane', 'frustum'])
  assert.deepEqual(kept, ['accepted'])
})

test('the post pass tests no filter, distance, parent group nor plane again: what it holds passed them in the main pass', () => {
  const { run, calls, kept } = descent('filter')
  run.postItem(3, 0)
  run.postItem(100, 0)
  assert.deepEqual(calls, [], 'a node held, a cell held')
  assert.deepEqual(kept, ['accepted', 'queued'])
})

test('a cluster is tested by its plane before its frustum', () => {
  const text = DAG_SELECTION_SHADER,
    plane = 'if(outsideClipPlane(w,boxMin(r),boxMax(r))){return;}'
  assert.ok(text.includes(plane) && text.includes('if(!clusterInView(r,w,cluster))'))
  assert.ok(text.indexOf(plane) < text.indexOf('if(!clusterInView(r,w,cluster))'))
})
