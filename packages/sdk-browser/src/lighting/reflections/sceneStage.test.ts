// The scene stage's march of a ray through the global distance field and the light of the surface it meets read in the surface cache,
// shipped WGSL and TypeScript run as JavaScript (`shaderRun`). Split from `wgsl.test.ts`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import type { Vec3 } from '../../../../math/src/vector/vectorTuple.ts'
import { WORLD_AT_WGSL } from '../deferred/worldAtWgsl.ts'
import { reflectionRayLightWgsl } from './rayLightWgsl.ts'
import { sceneStage } from './sceneTrace.fixture.ts'
import { origin, ahead } from './rayPoints.fixture.ts'

test('a march that meets a surface answers the light the surface cache gives it, the ray stopped whole, its steps counted', () => {
  const walk = sceneStage({ hit: 0.5, steps: 12, bias: 0.05 })
  const found = walk(origin, ahead, [3, 4])
  assert.equal(found.fate, 'hit')
  assert.deepEqual([found.answer.hit, found.open, found.work], [true, false, 12])
  assert.ok(Math.abs(found.answer.distance - 0.55) < 1e-6, `${found.answer.distance}`)
  assert.deepEqual(found.answer.color, [1, 0.5, 0.25], 'the cache’s own light')
  // The cache is read at the march's hit, from the point the ray left the surface at (centimetres), for the pixel the ray is cast from.
  const [read] = walk.reads
  assert.deepEqual([read.origin, read.R, read.hitTime, read.coord], [[5, 0, 0], ahead, 50, [3, 4]])
})

test('a hit is read on the finest pages unless the setting says the coarsest', () => {
  for (const hiRes of [true, false]) {
    const walk = sceneStage({ hit: 0.5, hiRes })
    walk(origin, ahead)
    assert.deepEqual(
      [walk.reads[0].hiRes, walk.reads[0].fade, walk.reads[0].startedInside],
      [hiRes, false, -1],
    )
  }
})

test('the cone of a hit’s read is the ray’s cone angle through the pixel’s at the eye (`reflectionHitSpread`)', () => {
  const walk = sceneStage({ hit: 0.5 })
  walk(origin, ahead, [0, 0], 0, 0.3)
  assert.equal(Math.fround(walk.reads[0].spread), Math.fround(0.3))
  // A pixel's angle at the eye of atan(0.01) added to the ray's, the tangent of the sum; none under an orthographic projection (a spread of none).
  const spread = (eyeSpread: number, cone: number) =>
    shaderRun<{ reflectionHitSpread: (cone: number) => number }>(
      wgslModule(reflectionRayLightWgsl(1)),
      ['reflectionHitSpread'],
      { reflectionView: { eyeSpread } },
    ).reflectionHitSpread(cone)
  assert.ok(Math.abs(spread(Math.atan(0.01), 0) - 0.01) < 1e-7)
  assert.ok(Math.abs(spread(Math.atan(0.01), 0.1) - Math.tan(Math.atan(0.01) + 0.1)) < 1e-6)
  assert.ok(Math.abs(spread(0, 0.1) - Math.tan(0.1)) < 1e-6)
  // A cone of a sample of little probability, past a right angle (a pdf of 0.5 gives 2 radians, whose tangent is −2.19): the
  // widest footprint, never a tangent wrapped negative or infinite.
  for (const cone of [Math.PI / 2, 2, 1e4]) {
    const wide = spread(Math.atan(0.01), cone)
    assert.ok(Number.isFinite(wide) && wide > 1e6, `${cone}: ${wide}`)
  }
})

test('a surface no card of the cache gives any light of is a black hit at the march’s distance', () => {
  const dark = sceneStage({ hit: 0.5, light: null })(origin, ahead)
  assert.equal(dark.fate, 'hit')
  assert.deepEqual([dark.answer.hit, dark.open, dark.answer.color], [true, false, [0, 0, 0]])
  assert.ok(Math.abs(dark.answer.distance - 0.5) < 1e-6, `${dark.answer.distance}`)
})

test('a march that meets nothing leaves the scene; one the screen followed to the longest ray leaves it as well', () => {
  const nothing = sceneStage({ steps: 40 })(origin, ahead)
  assert.equal(nothing.fate, 'open', 'the cache is not read: the field met nothing')
  assert.deepEqual([nothing.answer.hit, nothing.open, nothing.work], [false, true, 40])
  // A ray the screen followed to the longest ray has nothing left to march: it leaves the scene, the far trace and the mirror sky follow.
  const bounded = sceneStage()(origin, ahead, [0, 0], 200)
  assert.equal(bounded.fate, 'bound')
  assert.deepEqual([bounded.answer.hit, bounded.open, bounded.work], [false, true, 0])
  // The march reaches the longest ray, and no further.
  const reached = (options: Parameters<typeof sceneStage>[0]) => {
    const walk = sceneStage(options)
    walk(origin, ahead)
    return walk.marches[0].maxTrace
  }
  assert.equal(reached({}), 200 * 100)
  assert.equal(reached({ longest: 80 }), 80 * 100)
})

test('with the scene traces off nothing is marched: a ray that would meet a surface goes whole to the sky', () => {
  const on = sceneStage({ hit: 5.5 })
  assert.equal(on(origin, ahead).fate, 'hit')
  const off = sceneStage({ hit: 5.5, traced: false })
  const walked = off(origin, ahead)
  assert.equal(walked.fate, 'open')
  assert.deepEqual(
    [walked.answer.hit, walked.open, walked.work, off.marches.length, off.reads.length],
    [false, true, 0, 0, 0],
  )
})

test('a scene with no field to march answers nothing, and reads no cache', () => {
  const bare = sceneStage({ hit: 0.5, clipmaps: 0 })
  const walked = bare(origin, ahead)
  assert.equal(walked.fate, 'noField')
  assert.deepEqual(
    [walked.answer.hit, walked.open, bare.marches.length, bare.reads.length],
    [false, false, 0, 0],
  )
})

test('the eye distance is the straight one under a perspective, the depth along the view under an orthographic camera', () => {
  const distance = (view: object, P: Vec3) =>
    shaderRun<{ viewEyeDistance: (P: Vec3) => number }>(
      wgslModule(WORLD_AT_WGSL),
      ['viewEyeDistance'],
      { view },
    ).viewEyeDistance(P)
  // A perspective camera at (0, 0, 10): the point (3, 4, 10) is 5 away.
  assert.equal(distance({ camera: [0, 0, 10, 1] }, [3, 4, 10]), 5)
  // An orthographic one looks down −z from the plane z = 10: the same point lies 0 from it, (3, 4, 4) and (0, 0, 4) 6.
  const ortho = { camera: [0, 0, 1, 0], display: [0, 0, 0, 10] }
  assert.equal(distance(ortho, [3, 4, 10]), 0)
  assert.equal(distance(ortho, [3, 4, 4]), 6)
  assert.equal(distance(ortho, [0, 0, 4]), 6)
})

test('the march starts where the screen stopped knowing the ray, less four half voxels of its clipmap, from the point the ray leaves the surface at', () => {
  const walk = sceneStage({ hit: 0.5, bias: 0.05 })
  walk(origin, ahead, [0, 0], 3)
  const [march] = walk.marches
  // The clipmap is 2 × 25 m across 252 voxels: a half voxel is 9.92 cm, four of them 39.7 cm, from 3 m, the distance the screen stage stored (its
  // lengthening of a miss already in it).
  const half = 2500 / 252
  assert.ok(Math.abs(march.minTrace - (300 - 4 * half)) < 1e-3, `${march.minTrace}`)
  assert.deepEqual(
    march.start,
    [5, 0, 0],
    'centimetres from the translated origin, 5 cm along the ray',
  )
  assert.deepEqual(march.dir, ahead)
  assert.equal(
    march.expandByTime,
    false,
    'the surface expands by the largest distance read, not the time',
  )
  assert.equal(march.minStepFactor, 1)
  // From the surface itself, the march starts at 0.
  const first = sceneStage({ hit: 0.5 })
  first(origin, ahead)
  assert.equal(first.marches[0].minTrace, 0)
})

test('the march’s step is the distance dithered about 1 near a mirror, and whole for a wide cone', () => {
  const factor = (cone: number, pixel: number[]) => {
    const walk = sceneStage({ hit: 0.5 })
    walk(origin, ahead, pixel, 0, cone)
    return walk.marches[0].stepFactor
  }
  const mirror = [0, 1, 2, 3, 4, 5, 6, 7].map((x) => factor(1e-5, [x, 3]))
  assert.ok(
    mirror.every((f) => f >= 0.95 - 1e-6 && f <= 1 / 0.95 + 1e-6),
    `${mirror}`,
  )
  assert.ok(new Set(mirror.map((f) => f.toFixed(4))).size > 4, 'the pixels’ noise differs')
  assert.ok(
    Math.abs(factor(Math.PI / 256, [3, 3]) - 1) < 1e-6,
    'a cone of π/256 and more steps whole',
  )
  assert.equal(factor(1, [3, 3]), 1)
  const half = factor(Math.PI / 512, [3, 3])
  const mirrorHere = factor(0, [3, 3])
  assert.ok(Math.abs(half - 1) < Math.abs(mirrorHere - 1) + 1e-6, 'half the cone: halfway to 1')
})
