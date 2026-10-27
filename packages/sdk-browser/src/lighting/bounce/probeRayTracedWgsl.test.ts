// The ray of a world probe cast through the scene's triangles (`probeRay`, `probeRayTracedWgsl.ts`), the shipped WGSL run as JavaScript
// (`shaderRun`) with the scene trace and the cards' read standing in as each test says: what the ray asks of the trace, and what it
// answers where it hits, where it leaves the scene and where the trace stopped short.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import type { Vec3 } from '../../../../math/src/vector/vectorTuple.ts'
import { MISS, type Hit } from '../rays/sceneTrace/sceneTraceHit.fixture.ts'
import type { ProbeRayModule } from './probeRay.fixture.ts'
import { CACHE_TRACED_HIT, CACHE_TRACED_SCENE } from './cache/cacheBindings.ts'
import { CACHE_TRACED_PROGRAM } from './cache/cacheTraceWgsl.ts'
import { probeRayTracedWgsl } from './probeRayTracedWgsl.ts'

/** `probeRay` from the world point [11, 2, 3] along +x over `[0.3, 20]` metres, the eye at [10, 0, 0], where the trace answers `hit`
 *  after `steps`, complete or not. What the trace and the cards' read were asked is returned beside the answer. */
function ray(hit: Hit, complete = true, steps = 9, reach = 20) {
  const asked: { ray?: Record<string, unknown>; cards?: unknown[] } = {}
  const { probeRay } = shaderRun<ProbeRayModule>(
    wgslModule(probeRayTracedWgsl(CACHE_TRACED_HIT, CACHE_TRACED_SCENE)),
    ['probeRay'],
    {
      cache: { eye: [10, 0, 0, 0], traced: [0.08, 10, 10] },
      stTrace: (traced: Record<string, unknown>) => ((asked.ray = traced), hit),
      stSteps: steps,
      stComplete: complete,
      scHitPlacement: (placement: number) => placement + 100,
      scPlacementMeshCards: (instance: number) => instance + 1000,
      scEvaluateMeshCards: (...args: unknown[]) => ((asked.cards = args), { radiance: [1, 2, 3] }),
    },
  )
  return { answer: probeRay([11, 2, 3], [1, 0, 0], 0.3, reach, 4, [5, 6]), asked }
}

const HIT: Hit = { ...MISS, hit: true, distance: 2.5, placement: 3, object: 7, normal: [-1, 0, 0] }

test('the ray goes in the eye’s frame, from the least trace to the reach less the pullback, passing the translucent and culling no face', () => {
  const { ray: traced } = ray(HIT).asked as { ray: Record<string, unknown> }
  assert.deepEqual(
    [traced.origin, traced.direction, traced.tMin, traced.tMax, traced.flags],
    [[1, 2, 3], [1, 0, 0], 0.3, 20 - 0.08, 16],
  )
})

test('a hit answers the light of the cards of its placement at its point, over the cone of a ray of its side, with the sampling depth bias', () => {
  const { answer, asked } = ray(HIT)
  assert.deepEqual(answer, {
    lighting: [1, 2, 3],
    open: 0,
    distance: 2.5,
    steps: 9,
    front: true,
    twoSided: false,
  })
  const [cards, at, normal, radius, bias, hiRes, coord] = asked.cards as [
    number,
    Vec3,
    Vec3,
    number,
    number,
    boolean,
    number[],
  ]
  // The object named by the trace, the table of instances and the cache's placement in turn.
  assert.equal(cards, 1107)
  assert.deepEqual(
    [at, normal, bias, hiRes, coord],
    [[1350, 200, 300], [-1, 0, 0], 10, false, [5, 6]],
  )
  assert.ok(
    Math.abs(radius - (250 * Math.sqrt(1 - (15 / 16) ** 2)) / (15 / 16)) < 1e-3,
    'acos(1 - 1/16)',
  )
})

test('a hit nearer than the least distance the cards are read from is a hit that brings no light', () => {
  const near = ray({ ...HIT, distance: 0.05 }).answer
  assert.deepEqual([near.lighting, near.open, near.distance], [[0, 0, 0], 0, 0.05])
})

test('a ray that hits nothing leaves the scene: no light, open, to the end of its trace', () => {
  assert.deepEqual(ray(MISS).answer, {
    lighting: [0, 0, 0],
    open: 1,
    distance: 20 - 0.08,
    steps: 9,
    front: true,
    twoSided: false,
  })
})

test('a trace that stopped short and found nothing is a black hit at the end; one that held a hit keeps the hit’s light', () => {
  assert.deepEqual(ray(HIT, false).answer, {
    lighting: [1, 2, 3],
    open: 0,
    distance: 2.5,
    steps: 9,
    front: true,
    twoSided: false,
  })
  assert.deepEqual(ray(MISS, false).answer, {
    lighting: [0, 0, 0],
    open: 0,
    distance: 20 - 0.08,
    steps: 9,
    front: true,
    twoSided: false,
  })
})

test('the back of a one-sided primitive is a hit that brings no light, and says it is a back; a two-sided one’s back brings it', () => {
  const back = { ...HIT, frontFace: false }
  assert.deepEqual(ray(back).answer, {
    lighting: [0, 0, 0],
    open: 0,
    distance: 2.5,
    steps: 9,
    front: false,
    twoSided: false,
  })
  const two = ray({ ...back, twoSided: true }).answer
  assert.deepEqual([two.lighting, two.front, two.twoSided], [[1, 2, 3], false, true])
})

test('the ray ends no sooner than it begins', () => {
  const { answer, asked } = ray(MISS, true, 0, 0.2)
  assert.equal(asked.ray?.tMax, 0.3)
  assert.equal(answer.distance, 0.3)
})

test('the program that holds it declares the scene trace in the group after the cache’s own', () => {
  assert.match(
    CACHE_TRACED_PROGRAM,
    new RegExp(
      `@group\\(${CACHE_TRACED_SCENE.group}\\) @binding\\(${CACHE_TRACED_SCENE.first}\\) var<uniform> stParams`,
    ),
  )
})
