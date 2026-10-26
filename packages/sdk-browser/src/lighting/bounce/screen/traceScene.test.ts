// The scene stage's answer to a ray the screen left (`spSceneRay`, `traceSceneWgsl.ts`), the shipped WGSL run as JavaScript (`shaderRun`) with
// the march and the radiance cache standing in as each test says: the ray is marched through the field first, the cache read only for what
// the march leaves.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import type { Vec3 } from '../../../../../math/src/vector/vectorTuple.ts'
import { traceSceneShader } from './traceSceneWgsl.ts'

/** What the march was asked, call by call. */
type March = { begin: number; reach: number; coord: number[]; side: number }

/**
 * `spSceneRay` of a probe moving at `speed` whose ray the screen left at `missed` metres, the probe's reach 20 m, where the march
 * `hits` (its light `[1, 2, 3]`) or leaves the ray, the radiance cache giving the light `[4, 5, 6]` at 12 metres, with the scene
 * traces `on` or not.
 */
function sceneRay(hits: boolean, missed = 0.5, on = true, speed = 0) {
  const marches: March[] = []
  const far: Vec3[] = []
  const { spSceneRay } = shaderRun<{
    spSceneRay: (
      probe: object,
      d: Vec3,
      missed: number,
      coord: number[],
      side: number,
    ) => { radiance: Vec3; word: number[] }
  }>(traceSceneShader(8, [4, 4]), ['spSceneRay'], {
    sp: { motion: [0.005, 0, 0, 0.0001], scene: [0.05, 0.01] },
    SP_FLAG_SCENE_TRACES: 1,
    spFlag: (bit: number) => bit === 1 && on,
    spLocalReach: () => 20,
    spMarch: (_: object, __: Vec3, begin: number, reach: number, coord: number[], side: number) => {
      marches.push({ begin, reach, coord, side })
      return { lighting: hits ? [1, 2, 3] : [0, 0, 0], hit: hits }
    },
    spFarOf: (point: Vec3) => (far.push(point), { radiance: [4, 5, 6], distance: 12 }),
    spHitWord: (distance: number, moving: boolean) => [distance, moving],
  })
  const probe = { P: [1, 1, 1], depth: 10, N: [0, 1, 0], speed }
  const ray = spSceneRay(probe, [1, 0, 0], missed, [3, 4], 8)
  return { ray, marches, far }
}

test('a ray the march hits answers the light of its hit and the reach of the probe, and reads the radiance cache for none of it', () => {
  const { ray, marches, far } = sceneRay(true)
  assert.deepEqual(ray.radiance, [1, 2, 3])
  assert.deepEqual(ray.word, [20, false], 'the end is the reach')
  assert.equal(marches.length, 1)
  assert.deepEqual(far, [], 'the cache is read only for the rays the march left')
})

test('a ray the march leaves answers the radiance cache’s light and distance', () => {
  const { ray, far } = sceneRay(false)
  assert.deepEqual(ray.radiance, [4, 5, 6])
  assert.deepEqual(ray.word, [12, false])
  assert.deepEqual(far, [[1, 1, 1]])
})

test('the march runs from two biases back of where the screen left the ray, no nearer than the least trace, to the reach of the probe’s cell', () => {
  const { marches } = sceneRay(false, 0.5)
  assert.deepEqual(marches[0], { begin: 0.4, reach: 20, coord: [3, 4], side: 8 })
  assert.equal(
    sceneRay(false, 0.05).marches[0].begin,
    0.0001,
    'a ray lost at the surface starts at the least trace',
  )
})

test('a ray that hits a probe that moves is moving; with the scene traces off nothing is marched and the cache answers the whole ray', () => {
  assert.deepEqual(sceneRay(true, 0.5, true, 1).ray.word, [20, true])
  const off = sceneRay(true, 0.5, false)
  assert.deepEqual(off.marches, [])
  assert.deepEqual(
    [off.ray.radiance, off.ray.word],
    [
      [4, 5, 6],
      [12, false],
    ],
  )
})
