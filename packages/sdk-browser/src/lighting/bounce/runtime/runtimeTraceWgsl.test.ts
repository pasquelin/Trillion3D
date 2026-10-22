// The run-time proxy's rays, the shipped WGSL run as JavaScript (`shaderRun`) over the same scene the
// CPU oracle walks (`runtimeSceneOracle.fixture.ts`): the two give the same hit and spend the same budget.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fieldRay, world } from './runtimeScene.fixture.ts'
import { freshSpent } from './runtimeOracle.fixture.ts'
import { lcgRandom } from '../../../../../math/src/sequence/random.ts'
import { NO_SKY, ahead, along, origin, runOver } from './runtimeRun.fixture.ts'
import { RAY_TRIANGLES, RAY_WORK, SURFACE_BLENDED } from './runtimeLayout.ts'
import { bruteForce, traceAny, traceScene } from './runtimeSceneOracle.fixture.ts'
import type { Vec3 } from '../../../../../math/src/vector/vectorTuple.ts'
import { NO_INDEX } from '../../../../../math/src/constants.ts'
import { Matrix4 } from '../../../../../sdk-core/src/world/math/matrix4.ts'
import { buildCutProxy } from '../../../geometry/runtime/runtimeProxy.ts'
import { cubeGeometry } from '../../../geometry/runtime/cube.fixture.ts'
import { sdkWasm } from '../../../wasm/sdkWasm.fixture.ts'
import { proxyArena, proxyHeader } from '../proxyBuffer.fixture.ts'

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
      run = runOver(w, NO_SKY, { RT_SHADOW_WORK: RAY_WORK, RT_SHADOW_TRIANGLES: RAY_TRIANGLES })
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

/** A probe's ray over `scene` with `budget`, each shadow ray its hits cast having `shadowBudget` of its own, the
 *  lighting of a hit casting one back toward the origin, where nothing stands: the point is lit, or shaded where
 *  the shadow ray is blocked. */
const shadowed = (scene: ReturnType<typeof world>, budget: number, shadowBudget = 1e6) => {
  const held: { blocked?: (o: Vec3, d: Vec3, span: number) => boolean } = {}
  const run = runOver(scene, NO_SKY, {
    RT_PROBE_WORK: budget,
    RT_SHADOW_WORK: shadowBudget,
    surfaceLit: (tint: Vec3, at: Vec3, _normal: Vec3, reach: number) =>
      held.blocked?.(at, [-1, 0, 0], reach) ? [0, 0, 0] : tint,
  })
  held.blocked = run.rtBlocked
  return run
}

test('a shadow ray that spends its own budget in the work is lit, and the probe ray it was cast for keeps its weight', () => {
  const w = world(2, 1, { places: along(2, 4) })
  // The ray meets the first cube at 3.5 and spends `own` units doing so; its shadow ray, walking the free segment
  // behind the hit, spends `cost` more.
  const alone = runOver(w, NO_SKY, { RT_PROBE_WORK: 1e6 })
  assert.deepEqual(alone.rtProbeRay(origin, ahead, 1000), [1, 1, 1, 3.5])
  const own = alone.testWork()
  const free = shadowed(w, 1e6)
  assert.deepEqual(free.rtProbeRay(origin, ahead, 1000), [1, 1, 1, 3.5], 'nothing stands: lit')
  const cost = free.testWork() - own
  assert.ok(cost > 1, `${cost} units`)
  assert.equal(free.testShadowFree(), 1)
  assert.equal(free.testShadowCause(), 0)
  // One unit short of what the shadow ray needs: it has not finished, and an unfinished shadow ray has found
  // nothing that stands in the light: lit, counted free and by what spent it, neither found nor blocked, the ray
  // it was cast for as it was (its distance is the hit's, its own walk finished).
  const spent = shadowed(w, 1e6, cost - 1)
  assert.deepEqual(spent.rtProbeRay(origin, ahead, 1000), [1, 1, 1, 3.5], 'lit, not shaded')
  assert.equal(spent.testShadowCause(), 1, 'its work')
  assert.equal(spent.testShadowFree(), 1, 'lit: free')
  assert.equal(spent.testShadowHit(), 0)
  assert.equal(spent.testCause(), 0, 'the ray’s own walk finished')
  assert.equal(spent.testOwnWork(), own, 'the shadow ray spent none of the ray’s units')
})

/** One placement of one mesh, `side` by `side` small cubes a metre apart in the plane z = 0: the mesh's own tree has
 *  inner nodes, and a ray between two rows of cubes meets their boxes and none of their triangles. */
const lattice = (side: number) => {
  const { indices, positions } = cubeGeometry()
  const count = side * side
  const moved = new Float32Array(positions.length * count),
    joined = new Uint32Array(indices.length * count)
  for (let k = 0; k < count; k++) {
    const [x, y] = [k % side, Math.floor(k / side)]
    positions.forEach((p, i) => {
      const axis = i % 3
      moved[k * positions.length + i] = p * 0.2 + (axis === 0 ? x : axis === 1 ? y : 0)
    })
    indices.forEach((v, i) => (joined[k * indices.length + i] = v + 8 * k))
  }
  const surfaces = [[0.5, 0.25, 0, 1, 0, 0, 0, 0]]
  const arena = proxyArena(buildCutProxy(sdkWasm, joined, moved), surfaces)
  const header = proxyHeader(arena, { instances: 1, treeRoot: NO_INDEX, members: 1 })
  return {
    ...world(1, 1, { places: [new Matrix4()], surfaces }),
    header: { ...header, words: arena.words },
  }
}

test('a shadow ray whose placement’s cut ran out of stack is blocked, one that finished the same walk is lit', () => {
  const mesh = lattice(6)
  const between: Vec3 = [-10, 0.5, 0]
  const finished = runOver(mesh)
  finished.rtBegin()
  assert.equal(finished.rtBlocked(between, ahead, 100), false, 'the rows leave the segment free')
  assert.equal(finished.testShadowFree(), 1)
  assert.equal(finished.testShadowCause(), 0)
  // The stack that holds one node: the walk of the cut has no room for the second box it meets and is exhausted
  // there, which the placement answers as shade: its own walk could not tell.
  const overflowed = runOver(mesh, NO_SKY, { STACK_DEPTH: 1 })
  overflowed.rtBegin()
  assert.equal(overflowed.rtBlocked(between, ahead, 100), true, 'blocked')
  assert.equal(overflowed.testShadowCause(), 4, 'a mesh’s walk')
  assert.equal(overflowed.testShadowFree() + overflowed.testShadowHit(), 0, 'neither lit nor found')
})

test('a probe ray’s own walk is as long with its shadow rays as without them, whatever its budget', () => {
  // Six blended cubes in a row: the ray goes through them layer by layer, the lighting of each hit casting a
  // shadow ray back, which spends units of its own.
  const glass = world(6, 1, {
    places: along(6, 4),
    surfaces: [[1, 1, 1, 0.5, 0, 0, 0, SURFACE_BLENDED]],
  })
  const alone = runOver(glass, NO_SKY, { RT_PROBE_WORK: 1e6 })
  const whole = alone.rtProbeRay(origin, ahead, 1000)
  const own = alone.testWork()
  const both = shadowed(glass, 1e6)
  both.rtProbeRay(origin, ahead, 1000)
  assert.ok(both.testWork() > own + 10, `${both.testWork()} units against ${own}`)
  assert.equal(both.testOwnWork(), own, 'its own units, the shadow rays’ apart')
  // A budget the walk alone just fits, and one it just misses: the walk spends the same, answers the same and is
  // exhausted by the same cause with the shadow rays as without.
  for (const [budget, cause] of [
    [own + 20, 0],
    [own - 2, 1],
  ]) {
    const without = runOver(glass, NO_SKY, { RT_PROBE_WORK: budget })
    const answer = without.rtProbeRay(origin, ahead, 1000)
    assert.equal(without.testCause(), cause, `${budget} units: exhausted or not`)
    const run = shadowed(glass, budget)
    assert.deepEqual(run.rtProbeRay(origin, ahead, 1000), answer, `${budget} units: the answer`)
    assert.equal(run.testOwnWork(), without.testOwnWork(), `${budget} units: its walk`)
    assert.equal(run.testCause(), without.testCause(), `${budget} units: its cause`)
    assert.equal(run.testShadowCause(), 0, `${budget} units: no shadow ray spent its own`)
  }
  assert.deepEqual(
    shadowed(glass, own + 20).rtProbeRay(origin, ahead, 1000),
    whole,
    'as the ray alone',
  )
})
