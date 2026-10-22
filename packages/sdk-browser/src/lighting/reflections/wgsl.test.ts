// The reflection's cone and fades, its scene stage and its view, shipped WGSL and TypeScript run as
// JavaScript (`shaderRun`): the cone's half-angle at the GGX lobe's half maximum, the fades that blend the
// screen into the environment — the image's edge, the footprint's pyramid level —, the rings a ray's
// walk of the scene is cut into, the budget of each and the detail window ahead of them, and that nothing the
// reflection reads turns with the frame.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { withoutComments } from '../../../../math/src/wgsl/comments.fixture.ts'
import { lcgRandom } from '../../../../math/src/sequence/random.ts'
import type { Vec3 } from '../../../../math/src/vector/vectorTuple.ts'
import { BOUNCE_SETTINGS } from '../../../../sdk-core/src/bounce/contracts.ts'
import { defaultReflections } from '../../../../sdk-core/src/contracts/reflectionOptions.ts'
import { ahead, origin } from '../bounce/runtime/runtimeRun.fixture.ts'
import { Matrix4 } from '../../../../sdk-core/src/world/math/matrix4.ts'
import { world } from '../bounce/runtime/runtimeScene.fixture.ts'
import { REFLECTION_CONSTANTS } from './constants.ts'
import { REFLECTION_CONE_WGSL } from './field.ts'
import { cubesAlong, fittedWorld, fogLights, sceneStage } from './proxyStage.fixture.ts'
import { reflectionStagesWgsl } from './wgsl.ts'
import { WORLD_AT_WGSL } from '../deferred/worldAtWgsl.ts'
import { reflectionRayLightWgsl } from './rayLightWgsl.ts'

type Cone = {
  reflectionConeTangent: (alpha: number) => number
  reflectionEdgeFade: (pixel: number[], size: number[]) => number
  reflectionLevelTrust: (level: number, top: number) => number
}
const cone = shaderRun<Cone>(
  wgslModule(REFLECTION_CONE_WGSL),
  ['reflectionConeTangent', 'reflectionEdgeFade', 'reflectionLevelTrust'],
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

test('the screen gives way to the environment over the last level below the pyramid top, smoothly', () => {
  const top = 8
  assert.equal(cone.reflectionLevelTrust(0, top), 1)
  assert.equal(cone.reflectionLevelTrust(top - 1, top), 1)
  assert.equal(cone.reflectionLevelTrust(top, top), 0)
  assert.equal(cone.reflectionLevelTrust(top + 3, top), 0)
  assert.ok(Math.abs(cone.reflectionLevelTrust(top - 0.5, top) - 0.5) < 1e-6)
  let last = 1
  for (let level = top - 1; level <= top; level += 1 / 64) {
    const trust = cone.reflectionLevelTrust(level, top)
    assert.ok(trust <= last && last - trust < 0.05, 'no step')
    last = trust
  }
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

const RINGS = [4, 8, 16, 32]
const RING = defaultReflections().ringWork
/** The units a ray spends over `scene`, in rings of `work` each, from `at` along +x: its first cube's ring and the rest's. */
const ringWorks = (scene: ReturnType<typeof cubesAlong>) => {
  const total = sceneStage(scene, { halves: RINGS, work: 1e6 })(origin, ahead).work
  const near = sceneStage(scene, { halves: [4], work: 1e6 })(origin, ahead).work
  return { near, far: total - near }
}

test('over a fitted street the scene stage’s rays end on a surface or the sky, none on their budget', () => {
  const random = lcgRandom(7)
  for (const count of [400, 1000]) {
    const street = fittedWorld(count, count)
    const rays = Array.from({ length: 24 }, () => {
      const angle = random() * 6.28
      return {
        origin: [random() * 60, 0.5, random() * 60] as Vec3,
        direction: [Math.cos(angle), 0.3 * random(), Math.sin(angle)] as Vec3,
      }
    })
    const ended = (work: number) => {
      const walk = sceneStage(street, { halves: [10, 20, 40, 80], work })
      return rays.map(({ origin, direction }) => walk(origin, direction).fate)
    }
    // The default budget of a ring, 256 steps: every ray finishes, on a surface or out of the scene.
    const fates = ended(RING)
    assert.deepEqual([...new Set(fates)].sort(), ['hit', 'open'], `${count} placements`)
    // The budget the whole ray had before the rings, 64 units: the first scan of the tree spends it, as the old
    // census showed, and a ray that leaves the scene at once is the one that does not.
    const short = ended(64)
    assert.ok(
      short.every((fate) => fate === 'open' || fate === 'work'),
      `${count} placements at 64 units`,
    )
    assert.ok(short.filter((fate) => fate === 'work').length > 0.8 * rays.length)
  }
})

test('each ring has a budget of its own: a walk the whole ray would spend finishes in rings that fit it', () => {
  const scene = cubesAlong([1, 6], 1)
  const { near, far } = ringWorks(scene)
  assert.ok(far < near, `${far} units a far ring against ${near}`)
  // One segment the whole ray long: spent where the rings, each within the budget, are not.
  const single = sceneStage(scene, { work: near + 1 })(origin, ahead)
  assert.equal(single.fate, 'hit', 'a hit kept even where the single walk is spent')
  const rings = sceneStage(scene, { halves: RINGS, work: near + 1 })(origin, ahead)
  assert.equal(rings.fate, 'hit')
  assert.equal(rings.answer.confidence, 1)
  assert.equal(rings.open, 0)
  // The blended cube of the first ring and the opaque one behind it, both answered: more than the opaque tint alone.
  assert.ok(rings.answer.color[2] > 0.6 && rings.answer.color[0] < 0.6)
})

test('a ring spent having found a surface keeps it; rings all spent before they found one answer the sky', () => {
  const scene = cubesAlong([1, 6], 1)
  // Ten units: spent before the blended cube's second face, after its first: that surface answers.
  const kept = sceneStage(scene, { halves: RINGS, work: 10 })(origin, ahead)
  assert.equal(kept.fate, 'hit')
  assert.ok(kept.answer.confidence > 0 && Math.abs(kept.answer.distance - 0.5) < 1e-4)
  // One unit: every ring spent before it met a surface, nothing was met, the ray leaves the scene to the sky.
  const spent = sceneStage(scene, { halves: RINGS, work: 1 })(origin, ahead)
  assert.equal(spent.fate, 'work', 'counted by what spent the first ring')
  assert.equal(spent.answer.confidence, 0)
  assert.equal(spent.open, 1)
})

test('the rings are the cascades’ cubes: the first holds the ray’s start, the last ends the walk, and a cut by the screen’s surface ends it sooner', () => {
  assert.ok(BOUNCE_SETTINGS.cascadeLevels <= 4, 'the rings fit the four ends the tracer carries')
  const walk = (xs: number[], start: Vec3, bound?: number) =>
    sceneStage(cubesAlong(xs), { halves: RINGS, work: 1e6 })(start, ahead, bound)
  // From outside the finest cube: the walk starts in the next, whose ring reaches the cube at 1.
  const outside = walk([1], [-6, 0, 0])
  assert.equal(outside.fate, 'hit')
  assert.ok(Math.abs(outside.answer.distance - 6.5) < 1e-4, `${outside.answer.distance}`)
  // Past the outermost cube nothing is walked: a cube there is never met, the ray leaves to the sky.
  const beyond = walk([40], [0, 0, 0])
  assert.equal(beyond.fate, 'open')
  assert.equal(beyond.open, 1)
  // The surface the screen met bounds the walk: a cube behind it is not met, and the sky is not claimed.
  const bounded = walk([6], [0, 0, 0], 3)
  assert.equal(bounded.fate, 'miss')
  assert.deepEqual([bounded.answer.confidence, bounded.open], [0, 0])
  // With no cascades (no field), the walk is one ring.
  const alone = sceneStage(cubesAlong([6]), { work: 1e6 })(origin, ahead)
  assert.equal(alone.fate, 'hit')
})

test('with the scene traces off no ring is walked: a ray that would meet a surface goes whole to the sky', () => {
  const scene = cubesAlong([6])
  assert.equal(sceneStage(scene, { halves: RINGS, work: 1e6 })(origin, ahead).fate, 'hit')
  const off = sceneStage(scene, { halves: RINGS, work: 1e6, traced: false })(origin, ahead)
  assert.equal(off.fate, 'open')
  assert.deepEqual([off.answer.confidence, off.open, off.work], [0, 1, 0])
})

test('the detail window walks the first metres on its own budget: a surface in it answers, a spent one is a hit by noise', () => {
  // Seventy cubes in a row: a placement tree, whose first scan one unit of budget spends.
  const near = cubesAlong(Array.from({ length: 70 }, (_, k) => 1 + k))
  const detail = { distance: 1.8, work: 1e6 }
  const found = sceneStage(near, { halves: RINGS, work: RING, detail })(origin, ahead)
  assert.equal(found.fate, 'hit')
  assert.ok(Math.abs(found.answer.distance - 0.5) < 1e-4, `${found.answer.distance}`)
  // A window of one unit spends it before it met anything: a hit where it stopped, a surface of no tint, close to the eye.
  const stop = sceneStage(near, { halves: RINGS, work: RING, detail: { ...detail, work: 1 } })(
    origin,
    ahead,
  )
  assert.equal(stop.fate, 'hit')
  assert.deepEqual(
    [stop.answer.color, stop.answer.confidence, stop.answer.distance],
    [[1, 1, 1], 1, 0],
  )
  // Far from the eye its hits fade out: the noise does not take the stop, the rings find the cube.
  const far = sceneStage(near, {
    halves: RINGS,
    work: RING,
    detail: { ...detail, work: 1 },
    eye: [100, 0, 0],
  })(origin, ahead)
  assert.equal(far.fate, 'hit')
  assert.ok(Math.abs(far.answer.distance - 0.5) < 1e-4, `${far.answer.distance}`)
  assert.deepEqual(far.answer.color, [1, 0.5, 0.25], 'the cube’s own tint')
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

test('the scene starts where the screen stopped knowing the ray, and the ray leaves the surface along itself', () => {
  const cube = cubesAlong([1])
  const walk = (left: number, bias = 0) =>
    sceneStage(cube, { work: 1e6, bias })(origin, ahead, 1e9, [0, 0], left)
  // A cube 0.5 ahead lies in the part of the ray the screen proved clear: not walked from where the screen left it.
  assert.equal(walk(0).fate, 'hit')
  assert.equal(walk(3).fate, 'open', 'the screen saw nothing there: no hit in it')
  // A surface the ray leaves along itself by 0.75 starts inside the cube's slab: the back face at 1.5 answers.
  assert.ok(
    Math.abs(walk(0, 0.75).answer.distance - 1.5) < 1e-4,
    `${walk(0, 0.75).answer.distance}`,
  )
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

test('a ray leaves a proxy that bulges past its surface by the certified error, off the normal', () => {
  // The reflecting point at the origin, the proxy’s cube topping 0.1 above it: a ray along 45° that left it by 5 cm alone
  // starts inside the cube and meets its own copy of the surface; lifted by the error it clears it.
  const top = new Matrix4().makeTranslation(0.5, -0.4, 0)
  const bulge = world(1, 1, { places: [top] })
  const R: Vec3 = [Math.SQRT1_2, Math.SQRT1_2, 0]
  const ray = (error: number) =>
    sceneStage(bulge, { work: 1e6, bias: 0.05, error })(origin, R, 1e9).fate
  assert.equal(ray(0), 'hit', 'the surface’s own copy')
  assert.equal(ray(0.1), 'open', 'off the normal by the error')
})
