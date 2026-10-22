// The run-time proxy's rays, the shipped WGSL run as JavaScript (`shaderRun`) over the same scene the
// CPU oracle walks (`runtimeSceneOracle.fixture.ts`): the two give the same hit and spend the same budget.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fieldRay, world } from './runtimeScene.fixture.ts'
import { freshSpent } from './runtimeOracle.fixture.ts'
import { lcgRandom } from '../../../../../math/src/sequence/random.ts'
import { NO_SKY, ahead, along, origin, runOver } from './runtimeRun.fixture.ts'
import { RAY_WORK, SURFACE_BLENDED } from './runtimeLayout.ts'
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
      // The tree's groups took part of the work, its cells and the cuts the rest; a tree reads its members.
      assert.ok(run.testMembers() <= spent.work, `ray ${ray} tree work`)
      if (count === 400) assert.ok(run.testMembers() > 0, `ray ${ray} members`)
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
      assert.ok(run.testMembers() <= twin.work, `ray ${ray} tree work`)
      assert.equal(got, want.found, `ray ${ray}`)
      // The census counts what the shadow ray found: a free segment, or a surface.
      assert.equal(run.testShadowFree(), got ? 0 : 1, `ray ${ray} free`)
      assert.equal(run.testShadowHit(), got ? 1 : 0, `ray ${ray} blocked`)
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

/** A probe's ray over `scene` with `budget`, the lighting of its hits casting a shadow ray back toward the
 *  origin, where nothing stands: the point is lit, or shaded where the shadow ray is blocked. */
const shadowed = (scene: ReturnType<typeof world>, budget: number) => {
  const held: { blocked?: (o: Vec3, d: Vec3, span: number) => boolean } = {}
  const run = runOver(scene, NO_SKY, {
    RT_PROBE_WORK: budget,
    surfaceLit: (tint: Vec3, at: Vec3, _normal: Vec3, reach: number) =>
      held.blocked?.(at, [-1, 0, 0], reach) ? [0, 0, 0] : tint,
  })
  held.blocked = run.rtBlocked
  return run
}

test('a shadow ray that spends the budget is a blocker, and the probe ray it was cast for keeps its weight', () => {
  const w = world(2, 1, { places: along(2, 4) })
  // The ray meets the first cube at 3.5 and spends `walked` units doing so.
  const measure = runOver(w, NO_SKY, { RT_PROBE_WORK: 1e6 })
  assert.deepEqual(measure.rtProbeRay(origin, ahead, 1000), [1, 1, 1, 3.5])
  const walked = measure.testWork()
  const lit = (budget: number, scene = w) => shadowed(scene, budget)
  const free = lit(walked + 100)
  assert.deepEqual(free.rtProbeRay(origin, ahead, 1000), [1, 1, 1, 3.5], 'nothing stands: lit')
  assert.equal(free.testShadowFree(), 1)
  assert.equal(free.testShadowCause(), 0)
  // One unit left to the shadow ray, which spends it: blocked, counted by what spent it, neither free nor
  // found, and the ray is not dropped (its distance is the hit's, never minus a cause).
  const spent = lit(walked + 1)
  assert.deepEqual(spent.rtProbeRay(origin, ahead, 1000), [0, 0, 0, 3.5], 'shaded, not dropped')
  assert.equal(spent.testShadowCause(), 1, 'its work')
  assert.equal(spent.testShadowFree() + spent.testShadowHit(), 0)
  assert.equal(spent.testCause(), 0, 'the ray’s own walk finished')
  // A blended surface lets the ray go on to a second layer, which the shadow ray spent the budget of: the
  // shadow ray is what spent it, the ray's own walk is not counted as exhausted.
  const glass = world(2, 1, {
    places: along(2, 4),
    surfaces: [[1, 1, 1, 0.5, 0, 0, 0, SURFACE_BLENDED]],
  })
  const through = lit(walked + 1, glass)
  assert.equal(through.rtProbeRay(origin, ahead, 1000)[3], 3.5, 'the first surface’s distance')
  assert.equal(through.testShadowCause(), 1, 'the shadow ray spent it')
  assert.equal(through.testCause(), 0, 'not the ray’s own walk')
})

test('a probe ray whose own walk crosses the budget in a later layer is exhausted by its walk, not by the shadow rays before it', () => {
  // Six blended cubes in a row: the ray goes through them layer by layer, the lighting of each hit casting a
  // shadow ray back, which spends part of the one budget the next layer's walk then shares.
  const glass = world(6, 1, {
    places: along(6, 4),
    surfaces: [[1, 1, 1, 0.5, 0, 0, 0, SURFACE_BLENDED]],
  })
  // Its own walk of every layer spends `own` units alone; with the shadow rays it costs more.
  const alone = runOver(glass, NO_SKY, { RT_PROBE_WORK: 1e6 })
  alone.rtProbeRay(origin, ahead, 1000)
  const own = alone.testWork()
  const both = shadowed(glass, 1e6)
  both.rtProbeRay(origin, ahead, 1000)
  assert.ok(both.testWork() > own + 10, `${both.testWork()} units against ${own}`)
  // A budget just under what the walk needs alone: it is the walk that crosses it, in a layer past the first,
  // where the shadow rays already hold part of the budget.
  const run = shadowed(glass, own - 2)
  run.rtProbeRay(origin, ahead, 1000)
  assert.equal(run.testCause(), 1, 'the walk spent the units')
  assert.equal(run.testShadowCause(), 0, 'not a shadow ray')
})
