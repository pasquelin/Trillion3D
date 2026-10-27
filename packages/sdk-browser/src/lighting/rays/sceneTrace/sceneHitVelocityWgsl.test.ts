// How far the surface a ray met moved since the last drawn frame (`stHitVelocity`): the hit's point carried by the placement's motion, `previous · current⁻¹` of its two worlds at the eye, run in
// JavaScript from the shipped text over the worlds' records as the shader reads them (`worldTable.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslModule } from '../../../../../math/src/wgsl/assemble.ts'
import { DAG_BINDING } from '../../../geometry/dag/shader/bindings.ts'
import { worldTableWgsl } from '../../../geometry/dag/worlds/worldTable.ts'
import { doubleWords, poseTexel } from '../../../geometry/dag/worlds/worldPoses.fixture.ts'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import { SCENE_HIT_VELOCITY_WGSL, sceneHitVelocityEntry } from './sceneHitVelocityWgsl.ts'

/** A world of column-major elements: the linear part's columns `x`, `y`, `z`, then the translation `t`. */
const world = (x: number[], y: number[], z: number[], t: number[]) => [
  ...x,
  0,
  ...y,
  0,
  ...z,
  0,
  ...t,
  1,
]
/** A world of a uniform `scale`, then the translation `t`. */
const scaled = (scale: number, t: number[]) => world([scale, 0, 0], [0, scale, 0], [0, 0, scale], t)

/** The eye `e` as the shader takes it: three doubles in two words each, x and y, then z. */
const eyeWords = (e: number[]) => [
  [...doubleWords(e[0]), ...doubleWords(e[1])],
  [...doubleWords(e[2]), 0, 0],
]

/** The velocity of the hit `at` on placement 0 whose world is `now` and was `before`, the eye at `eye`,
 *  the worlds read from their records (`worldTableWgsl`) at it. */
const velocity = (now: number[], before: number[], at: number[], eye = [0, 0, 0]) => {
  const [e0, e1] = eyeWords(eye)
  return shaderRun<{
    stHitVelocity: (w: number, at: number[], e0: number[], e1: number[]) => number[]
  }>(
    wgslModule(
      worldTableWgsl('worlds', { group: 0, binding: DAG_BINDING.worlds, access: 'read' }),
      SCENE_HIT_VELOCITY_WGSL,
    ),
    ['stHitVelocity'],
    {
      worlds: { pose: now },
      previous: { pose: before },
      textureLoad: (table: unknown, from: number[]) => poseTexel(table, from[0]),
    },
  ).stHitVelocity(0, at, e0, e1)
}

const near = (got: number[], expected: number[]) =>
  expected.forEach((value, k) =>
    assert.ok(Math.abs(got[k] - value) < 1e-5, `[${got}] against [${expected}]`),
  )

test('a hit on a placement that did not move has exactly no velocity, whatever its pose and the eye', () => {
  assert.deepEqual(velocity(scaled(1, [1, 0, 0]), scaled(1, [1, 0, 0]), [3, 2, 1]), [0, 0, 0])
  const c = 1.7 * Math.cos(0.3),
    s = 1.7 * Math.sin(0.3)
  const turned = world([c, s, 0], [-s, c, 0], [0, 0, 1.7], [4.25, -2.5, 7.125])
  assert.deepEqual(
    velocity(turned, turned, [3.3, -1.1, 0.7], [1000.5, -20.25, 98765.125]),
    [0, 0, 0],
  )
})

test('a placement that moved by a metre along x has that metre', () => {
  near(velocity(scaled(1, [1.5, 0, 0]), scaled(1, [0.5, 0, 0]), [3, 2, 1]), [1, 0, 0])
})

test('the point is carried by the placement’s own space: a placement that doubled in size moved a hit at its local point by that point', () => {
  // Local point (2, 0, 0) of a world of scale 2 at the origin is (4, 0, 0); the last frame drew the placement at scale 1: it stood at (2, 0, 0).
  near(velocity(scaled(2, [0, 0, 0]), scaled(1, [0, 0, 0]), [4, 0, 0]), [2, 0, 0])
})

test('a placement turned a quarter about z and moved: the point goes back through the turn, then out by the pose it had', () => {
  // Now: x to y, y to -x, at (1, 0, 0); the hit (1, 3, 0) is the local point (3, 0, 0). Before: a half turn about z at (2, 0, 0): the local point stood at (-1, 0, 0).
  const now = world([0, 1, 0], [-1, 0, 0], [0, 0, 1], [1, 0, 0])
  const before = world([-1, 0, 0], [0, -1, 0], [0, 0, 1], [2, 0, 0])
  near(velocity(now, before, [1, 3, 0]), [2, 3, 0])
})

test('a placement of a non-uniform scale carries a hit along each axis by its own factor', () => {
  // Local point (2, 2, 2) of the scales (2, 3, 4) at (1, 1, 1) is (5, 7, 9); before, the scale was 1 at the origin.
  const now = world([2, 0, 0], [0, 3, 0], [0, 0, 4], [1, 1, 1])
  near(velocity(now, scaled(1, [0, 0, 0]), [5, 7, 9]), [3, 5, 7])
})

test('a placement whose world is singular has exactly no velocity', () => {
  const flat = world([2, 0, 0], [0, 3, 0], [0, 0, 0], [1, 1, 1])
  assert.deepEqual(velocity(flat, scaled(1, [0, 0, 0]), [5, 7, 9]), [0, 0, 0])
})

test('the worlds are taken at the eye, its x and y words and its z words apart: a far placement keeps its metre', () => {
  const eye = [1000.5, -20.25, 98765.125]
  const at = (offset: number[]) =>
    scaled(
      1,
      eye.map((e, k) => e + offset[k]),
    )
  // The placement stood a metre less along x than it does, at the same height and depth from the eye.
  near(velocity(at([1, 2, 3]), at([0, 2, 3]), [1, 2, 3], eye), [1, 0, 0])
  near(velocity(at([1, 2, 3]), at([1, 2, 1]), [1, 2, 3], eye), [0, 0, 2])
})

test('the previous poses are bound in group 0 at the culling’s binding of them, as a table of words', () => {
  const entry = sceneHitVelocityEntry()
  assert.equal(entry.binding, DAG_BINDING.previous)
  assert.equal(entry.texture?.sampleType, 'uint')
  assert.equal(entry.texture?.viewDimension, '2d-array')
  assert.match(
    wgslModule(SCENE_HIT_VELOCITY_WGSL),
    new RegExp(`@group\\(0\\) @binding\\(${DAG_BINDING.previous}\\) var previous:`),
  )
})
