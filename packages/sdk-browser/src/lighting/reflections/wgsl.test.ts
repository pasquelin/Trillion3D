// The reflection's fade and the stages of a ray, shipped WGSL and TypeScript run as JavaScript (`shaderRun`): the fade that blends the
// screen into the environment at the image's edge, that nothing the reflection reads turns with the frame, and the screen and scene stages.
// The march of the scene stage and the fog of a ray have their own files (`sceneStage.test.ts`, `rayFog.test.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { withoutComments } from '../../../../math/src/wgsl/comments.fixture.ts'
import type { Vec3 } from '../../../../math/src/vector/vectorTuple.ts'
import { REFLECTION_VIGNETTE_WGSL } from './field.ts'
import { reflectionStagesWgsl } from './wgsl.ts'
import { origin, ahead } from './rayPoints.fixture.ts'

type Vignette = { reflectionVignette: (ndc: number[]) => number }
const vignette = shaderRun<Vignette>(
  wgslModule(REFLECTION_VIGNETTE_WGSL),
  ['reflectionVignette'],
  {},
)

test('the vignette keeps a hit whole inside four fifths of the half extent and falls to nothing at the edge, as 1 - v.v', () => {
  assert.equal(vignette.reflectionVignette([0, 0]), 1)
  assert.equal(vignette.reflectionVignette([0.8, -0.8]), 1)
  assert.equal(vignette.reflectionVignette([1, 0]), 0)
  assert.equal(vignette.reflectionVignette([-1, 0.3]), 0)
  // One axis past the margin: v = (0.5, 0), 1 - 0.25.
  assert.ok(Math.abs(vignette.reflectionVignette([0.9, 0]) - 0.75) < 1e-6)
  // Both axes: v = (0.5, 0.5), 1 - 0.5.
  assert.ok(Math.abs(vignette.reflectionVignette([-0.9, 0.9]) - 0.5) < 1e-6)
  // Past the edge, none; symmetric; falling from the margin to the edge.
  assert.equal(vignette.reflectionVignette([3, 0]), 0)
  let last = 1
  for (let x = 0.8; x <= 1; x += 0.0125) {
    const kept = vignette.reflectionVignette([x, 0])
    assert.ok(kept <= last + 1e-7, 'no rise')
    last = kept
  }
  assert.equal(vignette.reflectionVignette([0.95, 0.1]), vignette.reflectionVignette([-0.95, -0.1]))
})

test('a screen hit stands against the noise of its pixel at the frame index modulo eight, the smaller vignette of this image and the last; no deterministic fade is left', () => {
  const text = wgslModule(reflectionStagesWgsl(1))
  assert.match(
    text,
    /fn reflectionHitVignette\(S:vec2f,Q:vec2f\)->f32\{\s*return min\(reflectionVignette\(S\/view\.viewport\.xy\*2\.0-1\.0\),reflectionVignette\(Q\/reflectionView\.radiance\.xy\*2\.0-1\.0\)\);/,
  )
  assert.ok(
    text.includes(
      'interleavedGradientNoise(vec2f(coord)+vec2f(0.5),f32(reflectionView.temporal.y))',
    ),
  )
  assert.ok(text.includes('let noise=reflectionEdgeNoise(coord);'))
  assert.ok(text.includes('if(reflectionHitVignette(H,past.pixel)<noise){return seen;}'))
  // The march's hits also stand against the depth the last image kept at the place they landed; the far trace's do not.
  assert.ok(
    text.includes(
      'if(tested&&!reflectionPastAgrees(past,noise,reflectionView.historyThickness)){return seen;}',
    ),
  )
  assert.ok(
    text.includes('reflectionSeenAnswer(P,H.xy,H.z,marched.pixel,marched.plane,coord,true)'),
  )
  assert.ok(text.includes('plane,coord,false)'))
  assert.ok(text.includes('seen.hit=true;'))
  assert.ok(!text.includes('reflectionEdgeFade') && !text.includes('REFLECTION_EDGE'))
})

test('no reflection draws a random number of its own: no seed, no hash, no frame rank; its only frame input is the pixel’s vote at the frame index modulo eight', () => {
  // The code, not the declarations nor the comments: the bounce grid it shares with the diffuse
  // declares the probe update's frame counters, which nothing here reads.
  const text = withoutComments(wgslModule(reflectionStagesWgsl(1))).replace(
    /struct \w+\{[^}]*\}/g,
    '',
  )
  for (const name of ['seed', 'random', 'hash'])
    assert.doesNotMatch(text, new RegExp(`\\b${name}\\b`, 'i'), name)
  assert.deepEqual(
    [...new Set([...text.matchAll(/reflectionView\.temporal\.(\w)/g)].map(([, lane]) => lane))],
    ['y'],
    'the frame index modulo eight, nothing of the turn',
  )
  // The frame's rank is a member of the cascades' grid (`bounce.frame`) and of nothing else.
  assert.doesNotMatch(text, /\.frame\b/, 'the rank of the frame')
})

/** The screen and scene stages of a ray (`reflectionScreenBegin` and `reflectionScreenEnd`, `reflectionSceneStage`), run over the answers the test gives them. */
function stages(options: {
  seen?: { hit: boolean; color?: Vec3; distance?: number; left?: number }
  traced?: { hit: boolean; color?: Vec3; distance?: number; open: boolean }
  far?: { hit: boolean; color?: Vec3; distance?: number }
  screen?: boolean
  /** Whether the ray's biased origin lies inside the image (true when absent). */
  onScreen?: boolean
  /** The sphere that holds the first-person stand-ins (centre, radius), and the least distance a ray is handed off at. */
  standIns?: { sphere: number[]; minimum: number }
}) {
  const { seen, traced, far, screen = true, onScreen = true, standIns } = options
  const answer = (a: { hit: boolean; color?: Vec3; distance?: number }) => ({
    color: a.color ?? [0, 0, 0],
    hit: a.hit,
    distance: a.distance ?? 0,
  })
  const asked: { firstPerson?: unknown } = {}
  const run = shaderRun<{
    reflectionScreenBegin: (P: Vec3, N: Vec3, lobe: object) => { live: boolean }
    reflectionScreenEnd: (
      P: Vec3,
      N: Vec3,
      lobe: object,
      aimed: object,
      marched: object,
      coord: number[],
    ) => { radiance: Vec3; hit: boolean; distance: number }
    reflectionSceneStage: (
      P: Vec3,
      N: Vec3,
      lobe: object,
      begin: number,
      coord: number[],
      cone: number,
      firstPerson: boolean,
    ) => { radiance: Vec3; hit: boolean; distance: number }
  }>(
    wgslModule(reflectionStagesWgsl(1)),
    ['reflectionScreenBegin', 'reflectionScreenEnd', 'reflectionSceneStage'],
    {
      reflectionView: {
        traced: [screen ? 1 : 0, 0, 0, 0],
        march: [0, 0, 0, 100],
        light: [40, 0, 0, 0],
        firstPerson: standIns?.sphere ?? [0, 0, 0, 0],
        firstPersonMinimum: standIns?.minimum ?? 0.04,
      },
      reflectionDone: () => true,
      reflectionRayBias: () => 0,
      reflectionOriginOnScreen: () => onScreen,
      reflectionRayLobe: (lobe: { R: Vec3 }) => ({ R: lobe.R }),
      reflectionRaySpan: () => ({}),
      reflectionSeen: () => ({
        answer: answer(seen ?? { hit: false }),
        left: seen?.left ?? 0,
      }),
      reflectionSceneTrace: (...args: unknown[]) => {
        asked.firstPerson = args[6]
        return { answer: answer(traced ?? { hit: false }), open: !!traced?.open }
      },
      reflectionDistant: () => answer(far ?? { hit: false }),
      reflectionEnvironment: (_: Vec3, rough: number) =>
        rough === 0 ? [0.5, 0.5, 0.5] : [0.25, 0.25, 0.25],
      reflectionSkylightLeak: () => [0, 0, 0],
      reflectionFogged: (rgb: Vec3) => rgb,
      reflectionClampRay: (rgb: Vec3) => rgb,
      reflectionField: () => [0.125, 0.125, 0.125],
      reflectionFate: 0,
    },
  )
  // The screen stage as the kernel runs it: its begin, the march (the answers the test gives stand for it) and its end.
  const reflectionScreenStage = (P: Vec3, N: Vec3, lobe: object, coord: number[]) =>
    run.reflectionScreenEnd(P, N, lobe, run.reflectionScreenBegin(P, N, lobe), {}, coord)
  return Object.assign(run, { asked, reflectionScreenStage })
}

const ray = { R: ahead, axis: [0, 0, 0, 0], alpha: 0, along: 0 }

test('the screen stage ends a ray in a hit, whole and final, or in a miss that reached the distance the screen stopped knowing it at, lengthened by 2 cm', () => {
  const N: Vec3 = [0, 0, 1]
  const hit = stages({ seen: { hit: true, color: [1, 2, 3], distance: 4 } })
  const P = origin
  assert.deepEqual(hit.reflectionScreenStage(P, N, ray, [0, 0]), {
    radiance: [1, 2, 3],
    hit: true,
    distance: 4,
  })
  const miss = stages({ seen: { hit: false, left: 3 } }).reflectionScreenStage(P, N, ray, [0, 0])
  assert.deepEqual([miss.hit, miss.radiance], [false, [0, 0, 0]])
  assert.ok(Math.abs(miss.distance - 3.02) < 1e-6, `${miss.distance}`)
  // A distance past the longest ray is held to it, hit or miss.
  assert.equal(
    stages({ seen: { hit: false, left: 99.99 } }).reflectionScreenStage(P, N, ray, [0, 0]).distance,
    100,
  )
  assert.equal(
    stages({ seen: { hit: true, distance: 150 } }).reflectionScreenStage(P, N, ray, [0, 0])
      .distance,
    100,
  )
  // A screen not traced this image, or a surface facing away from the eye, ends a miss at 0.
  const none = stages({ seen: { hit: true, distance: 4 }, screen: false })
  assert.deepEqual(
    [
      none.reflectionScreenStage(P, N, ray, [0, 0]).hit,
      none.reflectionScreenStage(P, N, ray, [0, 0]).distance,
    ],
    [false, 0],
  )
  // A surface facing away from the eye is traced as any other: the stage has no gate on the facing.
  assert.equal(hit.reflectionScreenStage(P, N, ray, [0, 0]).hit, true)
  // A ray whose biased origin lies off the image is not traced on the screen: its stage ends at 0.
  const off = stages({ seen: { hit: true, distance: 4 }, onScreen: false })
  assert.deepEqual(
    [
      off.reflectionScreenStage(P, N, ray, [0, 0]).hit,
      off.reflectionScreenStage(P, N, ray, [0, 0]).distance,
    ],
    [false, 0],
  )
})

test('a ray the screen missed is handed off where it enters the sphere of the first-person stand-ins, no nearer than the least distance, a hit and a ray that misses it untouched', () => {
  const N: Vec3 = [0, 0, 1]
  const missAt = (standIns: { sphere: number[]; minimum: number } | undefined, left = 20) =>
    stages({ seen: { hit: false, left }, standIns }).reflectionScreenStage(origin, N, ray, [0, 0])
      .distance
  const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-5, `${a} is not ${b}`)
  // No stand-ins in the scene (radius 0): the miss goes on whole, the 2 cm lengthened.
  near(missAt(undefined), 20.02)
  near(missAt({ sphere: [5, 0, 0, 0], minimum: 0.04 }), 20.02)
  // A sphere of radius 1 about (5, 0, 0): the ray enters it at 4 m.
  near(missAt({ sphere: [5, 0, 0, 1], minimum: 0.04 }), 4)
  // A miss that stopped before the sphere keeps its own distance.
  near(missAt({ sphere: [5, 0, 0, 1], minimum: 0.04 }, 1), 1.02)
  // The least distance holds where the ray enters the sphere nearer than it: here at 0.5 m, the least 2 m.
  near(missAt({ sphere: [1.5, 0, 0, 1], minimum: 2 }), 2)
  // A ray that starts inside the sphere (it enters it at -0.5 m) is handed off at the least distance.
  near(missAt({ sphere: [0.5, 0, 0, 1], minimum: 0.04 }), 0.04)
  // A sphere the ray does not meet leaves it.
  near(missAt({ sphere: [5, 5, 0, 1], minimum: 0.04 }), 20.02)
  // A sphere wholly behind the ray (crossings at -11 m and -9 m) leaves it: the rule that takes any crossing other than a miss's
  // would hand it off at the least distance, 0.04 m, and lose the screen's reflection of every ray leaving the stand-ins.
  near(missAt({ sphere: [-10, 0, 0, 1], minimum: 0.04 }), 20.02)
  // A hit of the screen is final: the stand-ins do not clip it.
  const hit = stages({
    seen: { hit: true, distance: 9 },
    standIns: { sphere: [5, 0, 0, 1], minimum: 0.04 },
  })
  assert.equal(hit.reflectionScreenStage(origin, N, ray, [0, 0]).distance, 9)
})

test('the scene stage tells the scene trace whether the ray is cast from a first-person pixel', () => {
  const N: Vec3 = [0, 1, 0]
  for (const firstPerson of [false, true]) {
    const run = stages({ traced: { hit: false, open: false } })
    run.reflectionSceneStage(origin, N, ray, 3, [0, 0], 0, firstPerson)
    assert.equal(run.asked.firstPerson, firstPerson)
  }
})

test('the scene stage ends a ray in the scene’s hit, else the screen’s far hit where the ray left the scene, else the sky; a ray no card lit is the environment’s', () => {
  const P = origin
  const N: Vec3 = [0, 1, 0]
  const end = (options: Parameters<typeof stages>[0]) =>
    stages(options).reflectionSceneStage(P, N, ray, 3, [0, 0], 0, false)
  assert.deepEqual(end({ traced: { hit: true, color: [1, 1, 1], distance: 7, open: false } }), {
    radiance: [1, 1, 1],
    hit: true,
    distance: 7,
  })
  assert.deepEqual(
    end({ traced: { hit: false, open: true }, far: { hit: true, color: [2, 2, 2], distance: 9 } }),
    {
      radiance: [2, 2, 2],
      hit: true,
      distance: 100,
    },
  )
  const sky = end({ traced: { hit: false, open: true } })
  assert.deepEqual([sky.hit, sky.radiance], [false, [0.5, 0.5, 0.5]])
  assert.equal(
    sky.distance,
    100,
    'a ray that met nothing, or a far hit, is told at the longest ray',
  )
  const field = end({ traced: { hit: false, open: false } })
  assert.deepEqual([field.hit, field.radiance], [false, [0.125, 0.125, 0.125]])
  assert.equal(field.distance, sky.distance)
})
