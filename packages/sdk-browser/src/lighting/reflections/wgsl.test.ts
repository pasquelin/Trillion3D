// The reflection's cone and fade, its scene stage and its view, shipped WGSL and TypeScript run as
// JavaScript (`shaderRun`): the cone's half-angle at the GGX lobe's half maximum, the fade that blends the
// screen into the environment at the image's edge, the march of a ray through the
// global distance field and the light of the surface it meets read in the surface cache, and that nothing the
// reflection reads turns with the frame.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { withoutComments } from '../../../../math/src/wgsl/comments.fixture.ts'
import type { Vec3 } from '../../../../math/src/vector/vectorTuple.ts'
import { REFLECTION_CONSTANTS } from './constants.ts'
import { REFLECTION_CONE_WGSL } from './field.ts'
import { fogLights, sceneStage } from './sceneTrace.fixture.ts'
import { reflectionStagesWgsl } from './wgsl.ts'
import { WORLD_AT_WGSL } from '../deferred/worldAtWgsl.ts'
import { reflectionRayLightWgsl } from './rayLightWgsl.ts'

/** The point a ray leaves from and the direction it goes: the origin, along +x. */
const origin: Vec3 = [0, 0, 0]
const ahead: Vec3 = [1, 0, 0]

type Cone = {
  reflectionConeTangent: (alpha: number) => number
  reflectionEdgeFade: (pixel: number[], size: number[]) => number
}
const cone = shaderRun<Cone>(
  wgslModule(REFLECTION_CONE_WGSL),
  ['reflectionConeTangent', 'reflectionEdgeFade'],
  {},
)

test('the cone is closed on a mirror and opens with the lobe, as GGX at half its peak', () => {
  assert.equal(cone.reflectionConeTangent(0), 0)
  // Wider at every α, until the half-vector's angle reaches its 40° bound.
  let last = 0
  for (let alpha = 0.05; alpha <= 1; alpha += 0.05) {
    const tangent = cone.reflectionConeTangent(alpha)
    assert.ok(alpha > 0.6 ? tangent >= last : tangent > last, `wider at ${alpha}`)
    last = tangent
  }
  // Small α: the half-vector's half-maximum angle is α√(√2 − 1), the reflected cone's twice it.
  const alpha = 0.01
  assert.ok(
    Math.abs(cone.reflectionConeTangent(alpha) / (2 * alpha * Math.sqrt(Math.SQRT2 - 1)) - 1) <
      1e-3,
  )
  assert.ok(Number.isFinite(cone.reflectionConeTangent(1)))
})

test('a hit fades into the environment at the image edge, smoothly and only there', () => {
  const size = [320, 200],
    border = REFLECTION_CONSTANTS.REFLECTION_EDGE * size[1]
  assert.equal(cone.reflectionEdgeFade([160, 100], size), 1)
  assert.equal(cone.reflectionEdgeFade([border, border], size), 1)
  for (const at of [
    [0, 100],
    [320, 100],
    [160, 0],
    [160, 200],
  ])
    assert.equal(cone.reflectionEdgeFade(at, size), 0)
  let last = 0
  for (let x = 0; x <= border; x += border / 64) {
    const fade = cone.reflectionEdgeFade([x, 100], size)
    assert.ok(fade >= last && fade - last < 0.05, 'no step')
    last = fade
  }
  assert.equal(cone.reflectionEdgeFade([3, 100], size), cone.reflectionEdgeFade([317, 100], size))
})

test('nothing a reflection reads turns with the frame: no seed, no frame rank, no history', () => {
  // The code, not the declarations nor the comments: the bounce grid it shares with the diffuse
  // declares the probe update's frame counters, which nothing here reads.
  const text = withoutComments(wgslModule(reflectionStagesWgsl(1))).replace(
    /struct \w+\{[^}]*\}/g,
    '',
  )
  for (const name of ['jitter', 'seed', 'noise', 'history', 'random', 'hash'])
    assert.doesNotMatch(text, new RegExp(`\\b${name}\\b`, 'i'), name)
  // The frame's rank is a member of the cascades' grid (`bounce.frame`) and of nothing else.
  assert.doesNotMatch(text, /\.frame\b/, 'the rank of the frame')
})

test('a march that meets a surface answers the light the surface cache gives it, the ray stopped whole, its steps counted', () => {
  const walk = sceneStage({ hit: 0.5, steps: 12, bias: 0.05 })
  const found = walk(origin, ahead, 1e9, [3, 4])
  assert.equal(found.fate, 'hit')
  assert.deepEqual([found.answer.confidence, found.open, found.work], [1, 0, 12])
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

test('the cone of a hit’s read is the lobe’s and the pixel’s at the eye', () => {
  const walk = sceneStage({ hit: 0.5 })
  walk(origin, ahead)
  // A mirror has no cone: the pixel's alone, a hundredth of a metre of the world at a metre.
  assert.ok(Math.abs(walk.reads[0].spread - 0.01) < 1e-6, `${walk.reads[0].spread}`)
})

test('a surface no card of the cache gives any light of answers nothing: the probes’ field answers the ray', () => {
  const missed = sceneStage({ hit: 0.5, light: null })(origin, ahead)
  assert.equal(missed.fate, 'miss')
  assert.deepEqual([missed.answer.confidence, missed.open], [0, 0])
})

test('a march that meets nothing leaves the scene; one cut by the screen’s surface does not claim the sky', () => {
  const nothing = sceneStage({ steps: 40 })(origin, ahead)
  assert.equal(nothing.fate, 'open', 'the cache is not read: the field met nothing')
  assert.deepEqual([nothing.answer.confidence, nothing.open, nothing.work], [0, 1, 40])
  // The surface the screen met bounds the ray: the march is cut there, the field answers, the sky is not claimed.
  const bounded = sceneStage()(origin, ahead, 3)
  assert.equal(bounded.fate, 'miss')
  assert.deepEqual([bounded.answer.confidence, bounded.open], [0, 0])
  // The march reaches the scene’s edge and the longest ray, and no further.
  const reached = (options: Parameters<typeof sceneStage>[0]) => {
    const walk = sceneStage(options)
    walk(origin, ahead)
    return walk.marches[0].maxTrace
  }
  assert.equal(reached({}), 200 * 100)
  assert.equal(reached({ edge: 50, longest: 80 }), 50 * 100)
  assert.equal(reached({ edge: 150, longest: 80 }), 80 * 100)
})

test('with the scene traces off nothing is marched: a ray that would meet a surface goes whole to the sky', () => {
  const on = sceneStage({ hit: 5.5 })
  assert.equal(on(origin, ahead).fate, 'hit')
  const off = sceneStage({ hit: 5.5, traced: false })
  const walked = off(origin, ahead)
  assert.equal(walked.fate, 'open')
  assert.deepEqual(
    [walked.answer.confidence, walked.open, walked.work, off.marches.length, off.reads.length],
    [0, 1, 0, 0, 0],
  )
})

test('a scene with no field to march answers nothing, and reads no cache', () => {
  const bare = sceneStage({ hit: 0.5, clipmaps: 0 })
  const walked = bare(origin, ahead)
  assert.equal(walked.fate, 'noField')
  assert.deepEqual(
    [walked.answer.confidence, walked.open, bare.marches.length, bare.reads.length],
    [0, 0, 0, 0],
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
  walk(origin, ahead, 1e9, [0, 0], 3)
  const [march] = walk.marches
  // The clipmap is 2 × 25 m across 252 voxels: a half voxel is 9.92 cm, four of them 39.7 cm, from 3 m.
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
    walk(origin, ahead, 1e9, pixel, 0, cone)
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

test('what a ray brings back is fogged along its length where the settings and the scene say so', () => {
  const fogged = (fog: object | undefined, on = true) =>
    shaderRun<{ reflectionFogged: (rgb: Vec3, start: Vec3, along: Vec3) => Vec3 }>(
      wgslModule(reflectionRayLightWgsl(1)),
      ['reflectionFogged'],
      { directLights: fogLights(fog), reflectionDone: () => on },
    ).reflectionFogged([1, 1, 1], [0, 0, 0], [100, 0, 0])
  const height = { color: [0.5, 0.6, 0.7], density: 0.02 }
  assert.deepEqual(fogged(undefined), [1, 1, 1], 'no fog in the scene')
  assert.deepEqual(fogged(height, false), [1, 1, 1], 'the setting off')
  const seen = fogged(height)
  assert.ok(seen[0] < 1 && seen[2] > seen[0], `the fog’s colour over a hundred metres: ${seen}`)
})
