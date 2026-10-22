// The reflection's cone and fades, its scene stage and its view, shipped WGSL and TypeScript run as
// JavaScript (`shaderRun`): the cone's half-angle at the GGX lobe's half maximum, the fades that blend the
// screen into the environment — the image's edge, the footprint's pyramid level —, the rings a ray's
// walk of the scene is cut into and the budget of each, and that nothing the reflection reads turns with the frame.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { withoutComments } from '../../../../math/src/wgsl/comments.fixture.ts'
import { lcgRandom } from '../../../../math/src/sequence/random.ts'
import type { Vec3 } from '../../../../math/src/vector/vectorTuple.ts'
import { Matrix4 } from '../../../../sdk-core/src/world/math/matrix4.ts'
import {
  REFLECTION_RULES,
  reflectionRingWork,
} from '../../../../sdk-core/src/contracts/reflectionOptions.ts'
import { SURFACE_BLENDED } from '../bounce/runtime/runtimeLayout.ts'
import { world } from '../bounce/runtime/runtimeScene.fixture.ts'
import { REFLECTION_FATES } from './censusWgsl.ts'
import { REFLECTION_CONSTANTS } from './constants.ts'
import { REFLECTION_CONE_WGSL } from './field.ts'
import { REFLECTION_PROXY_WGSL } from './proxy.ts'
import { reflectionStagesWgsl } from './wgsl.ts'

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

/** The scene stage's walk (`reflectionProxied`, the shipped WGSL) over the proxy of `scene`, the cascades' cubes
 *  about the origin, their half-extents `halves` (eight cells a side), a ring's budget `work` units, `traced` whether the
 *  scene is traced at all: a ray from `origin` along `direction`, answered, with how it ended and the units it spent. */
function sceneStage(
  scene: ReturnType<typeof world>,
  halves: number[],
  work: number,
  traced = true,
) {
  const text = `${wgslModule(REFLECTION_PROXY_WGSL)}
fn testFate()->u32{return reflectionFate;}
fn testWork()->u32{return reflectionWork;}`
  const run = shaderRun<{
    reflectionProxied: (
      P: Vec3,
      N: Vec3,
      lobe: object,
      bound: number,
    ) => {
      answer: { color: Vec3; confidence: number; distance: number }
      open: number
    }
    reflectionLobeOf: (R: Vec3, alpha: number, lobe: number[]) => object
    testFate: () => number
    testWork: () => number
  }>(text, ['reflectionProxied', 'reflectionLobeOf', 'testFate', 'testWork'], {
    bounce: {
      counts: [8, halves.length, 0, halves.length ? 1 : 0],
      levels: halves.map((half) => ({ base: [-4, -4, -4], spacing: half / 4 })),
      reach: [200, 0, 0, 0],
    },
    reflectionView: {
      scene: [REFLECTION_RULES.reflectionScreenSteps.default, work, 1e6, traced ? 1 : 0],
    },
    rtProxy: scene.header,
    rtWorlds: scene.worlds,
    rtTree: scene.tree,
    ...Object.fromEntries(
      [
        ...['rtWork', 'rtTests', 'rtShadowWork', 'rtCause', 'rtReached', 'rtReachedPlacement'],
        ...['rtShadowFree', 'rtShadowHit', 'rtShadowCause', 'rtMembers'],
        ...['reflectionFate', 'reflectionWork'],
      ].map((name) => [name, 0]),
    ),
    rtBudget: 0,
    rtTestBudget: 0,
    rtAnyHit: false,
    surfaceLit: (tint: Vec3) => tint,
    surfaceSeen: (tint: Vec3) => tint,
  })
  return (origin: Vec3, direction: Vec3, bound = 1e9) => {
    const lobe = run.reflectionLobeOf(direction, 0, [0, 0, 0, 0])
    const out = run.reflectionProxied(origin, [0, 1, 0], lobe, bound)
    return { ...out, fate: REFLECTION_FATES[run.testFate()], work: run.testWork() }
  }
}

const ahead: Vec3 = [1, 0, 0]
const at = (...xs: number[]) => xs.map((x) => new Matrix4().makeTranslation(x, 0, 0))
const OPAQUE = [1, 0.5, 0.25, 1, 0, 0, 0, 0],
  GLASS = [0.2, 0.4, 1, 0.5, 0, 0, 0, SURFACE_BLENDED]
/** Unit cubes at the x of `xs`, the first `glass` of them blended: a ray along +x meets a blended cube's two faces. */
const cubes = (xs: number[], glass = 0) =>
  world(xs.length, 1, {
    places: at(...xs),
    surfaces: [OPAQUE, GLASS],
    surfaceOf: (w) => (w < glass ? 1 : 0),
  })
const RINGS = [4, 8, 16, 32]

test('over a street of four hundred placements the scene stage’s rays end on a surface or the sky, none on their budget', () => {
  const count = 400,
    street = world(count, count),
    random = lcgRandom(7)
  const rays = Array.from({ length: 40 }, () => {
    const angle = random() * 6.28
    return {
      origin: [random() * 6, 0.5, random() * 6] as Vec3,
      direction: [Math.cos(angle), 0, Math.sin(angle)] as Vec3,
    }
  })
  const ended = (work: number) => {
    const walk = sceneStage(street, [10, 20, 40, 80], work)
    return rays.map(({ origin, direction }) => walk(origin, direction).fate)
  }
  // The setting's default budget, a ring of 256 steps: every ray finishes, most on a surface.
  const fates = ended(reflectionRingWork(REFLECTION_RULES.reflectionRingSteps.default))
  assert.deepEqual(
    [...new Set(fates)].sort(),
    ['hit', 'open'],
    'a surface or the sky: no ray is left to its budget',
  )
  assert.ok(fates.filter((fate) => fate === 'hit').length > 10, 'many rays meet a surface')
  // The budget the walk had when it was one segment of 64 units, a node's scan: every ray spends it.
  assert.deepEqual(
    [...new Set(ended(64))],
    ['work'],
    'a ray of 64 units is spent by its first scan',
  )
})

test('each ring has a budget of its own: a walk the whole ray would spend finishes in rings that fit it', () => {
  const scene = cubes([1, 6], 1),
    big = 1e6
  const total = sceneStage(scene, RINGS, big)([0, 0, 0], ahead).work
  const near = sceneStage(scene, [4], big)([0, 0, 0], ahead).work
  const far = total - near
  assert.ok(far < near, `${far} units a far ring against ${near}`)
  // One segment the whole ray long: spent where the rings, each within the budget, are not.
  const budget = near + 1
  const single = sceneStage(scene, [], budget)([0, 0, 0], ahead)
  assert.equal(single.fate, 'work')
  assert.ok(single.work > budget - 1, `${single.work} units of ${budget}`)
  const rings = sceneStage(scene, RINGS, budget)([0, 0, 0], ahead)
  assert.equal(rings.fate, 'hit')
  assert.equal(rings.answer.confidence, 1)
  assert.equal(rings.open, 0)
  // The blended cube of the first ring and the opaque one behind it, both answered: more than the opaque tint alone.
  assert.ok(rings.answer.color[2] > 0.6 && rings.answer.color[0] < 0.6)
})

test('a ring that spends its budget is not seen: the ray goes on at its end, and a ray whose rings are all spent answers the sky', () => {
  const scene = cubes([1, 6], 1),
    big = 1e6
  const total = sceneStage(scene, RINGS, big)([0, 0, 0], ahead).work
  const near = sceneStage(scene, [4], big)([0, 0, 0], ahead).work
  const far = total - near
  // The first ring is spent, the second fits: the ray meets the opaque cube alone, the blended one unseen.
  const skipped = sceneStage(scene, RINGS, far + 1)([0, 0, 0], ahead)
  assert.equal(skipped.fate, 'hit')
  assert.deepEqual(skipped.answer.color, [1, 0.5, 0.25])
  assert.equal(skipped.answer.confidence, 1)
  assert.ok(Math.abs(skipped.answer.distance - 5.5) < 1e-4, `${skipped.answer.distance}`)
  // Both are spent: nothing was met, nothing is known of the rest, the ray leaves the scene to the sky.
  const spent = sceneStage(scene, RINGS, far)([0, 0, 0], ahead)
  assert.equal(spent.fate, 'work', 'counted by what spent the first ring')
  assert.equal(spent.answer.confidence, 0)
  assert.equal(spent.open, 1)
})

test('the rings are the cascades’ cubes: the first holds the ray’s start, the last ends the walk, and a cut by the screen’s surface ends it sooner', () => {
  const walk = (xs: number[], origin: Vec3, bound?: number) =>
    sceneStage(cubes(xs), RINGS, 1e6)(origin, ahead, bound)
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
  const alone = sceneStage(cubes([6]), [], 1e6)([0, 0, 0], ahead)
  assert.equal(alone.fate, 'hit')
})

test('with the scene traces off no ring is walked: a ray that would meet a surface goes whole to the sky', () => {
  const scene = cubes([6])
  const on = sceneStage(scene, RINGS, 1e6)([0, 0, 0], ahead)
  assert.equal(on.fate, 'hit')
  const off = sceneStage(scene, RINGS, 1e6, false)([0, 0, 0], ahead)
  assert.equal(off.fate, 'open')
  assert.deepEqual([off.answer.confidence, off.open, off.work], [0, 1, 0])
})
