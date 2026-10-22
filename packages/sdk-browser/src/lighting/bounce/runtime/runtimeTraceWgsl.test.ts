// The run-time proxy's rays, the shipped WGSL run as JavaScript (`shaderRun`) over the same scene the
// CPU oracle walks (`runtimeSceneOracle.fixture.ts`): the two give the same hit and spend the same budget.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fieldRay, world } from './runtimeScene.fixture.ts'
import { freshSpent } from './runtimeOracle.fixture.ts'
import { lcgRandom } from '../../../../../math/src/sequence/random.ts'
import { along, runOver } from './runtimeRun.fixture.ts'
import { RAY_WORK } from './runtimeLayout.ts'
import { bruteForce, traceAny, traceScene } from './runtimeSceneOracle.fixture.ts'
import type { Vec3 } from '../../../../../math/src/vector/vectorTuple.ts'

for (const count of [5, 400]) {
  test(`${count} placements: the shipped WGSL walks the tree and the cuts as the oracle does`, () => {
    const w = world(count, count),
      run = runOver(w)
    const random = lcgRandom(5)
    let hits = 0
    for (let ray = 0; ray < 120; ray++) {
      const { origin, direction } = fieldRay(random, count)
      const spent = freshSpent()
      const want = traceScene(w.scene, origin, direction, 100, spent)
      run.rtBegin()
      const got = run.rtScene(origin, direction, 100)
      assert.equal(run.testWork(), spent.work, `ray ${ray} work`)
      assert.equal(run.testTests(), spent.tests, `ray ${ray} tests`)
      if (got.found) hits++
      assert.equal(got.found, want.found, `ray ${ray}`)
      if (want.found) {
        assert.ok(Math.abs(got.distance - want.distance) < 1e-3 * want.distance, `ray ${ray}`)
        assert.equal(got.placement, want.placement, `ray ${ray}`)
      }
    }
    assert.ok(hits > 3, `${hits} hits`)
  })
}

test('a long ray across a dense field meets the near cube first, its budget never spent on far patches', () => {
  // 256 cubes on one line, the ray coming down it from the far end: the tree's groups lie along the line
  // in index order from its other end, so a walk in index order spends `RAY_WORK` on the farthest patch.
  const w = world(256, 1, { places: along(256, 3) }),
    run = runOver(w)
  assert.ok(w.packed.placementTree, 'a tree')
  const origin: Vec3 = [800, 0, 0],
    direction: Vec3 = [-1, 0, 0]
  const spent = freshSpent()
  const want = traceScene(w.scene, origin, direction, 1000, spent)
  run.rtBegin()
  const got = run.rtScene(origin, direction, 1000)
  for (const [hit, work] of [
    [want, spent.work],
    [got, run.testWork()],
  ] as const) {
    assert.ok(work < RAY_WORK, `${work} units: never exhausted`)
    assert.equal(hit.found, true)
    assert.equal(hit.placement, 255, 'the nearest cube')
    assert.ok(Math.abs(hit.distance - 31.5) < 1e-4, `${hit.distance}`)
  }
  assert.equal(run.testWork(), spent.work, 'the shipped walk and its twin spend alike')
})

for (const count of [5, 400]) {
  test(`${count} placements: a shadow ray walks the tree once, in index order, and is blocked where a triangle stands`, () => {
    const w = world(count, count),
      run = runOver(w)
    const random = lcgRandom(9)
    let blocked = 0,
      anyWork = 0,
      nearestWork = 0
    for (let ray = 0; ray < 120; ray++) {
      const { origin, direction } = fieldRay(random, count)
      const twin = freshSpent(),
        nearest = freshSpent()
      const want = traceAny(w.scene, origin, direction, 100, twin)
      traceScene(w.scene, origin, direction, 100, nearest)
      run.rtBegin()
      const got = run.rtBlocked(origin, direction, 100)
      // The shipped walk and its twin spend alike, and a shadow ray that is not exhausted answers what
      // every triangle tested in turn would.
      assert.equal(run.testWork(), twin.work, `ray ${ray} work`)
      assert.equal(got, want.found, `ray ${ray}`)
      if (twin.work < RAY_WORK) {
        assert.equal(
          got,
          bruteForce(w.scene, origin, direction, 100).found,
          `ray ${ray} visibility`,
        )
        anyWork += twin.work
        nearestWork += nearest.work
      }
      if (got) blocked++
    }
    assert.ok(blocked > 3 && blocked < 120, `${blocked} blocked`)
    assert.ok(
      anyWork <= nearestWork,
      `${anyWork} units against ${nearestWork} walked nearest first`,
    )
  })
}
