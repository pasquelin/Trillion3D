// The scene stage through the scene's triangles (`reflectionSceneTrace`, `sceneTraceHardware.ts`), the shipped WGSL run as JavaScript
// (`shaderRun`) with the scene trace and the cards' read standing in as each test says: what the ray asks of the trace, and what it
// answers where it hits, where it leaves the scene, where the trace stopped short and where the screen's surface leaves it nothing.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import type { Vec3 } from '../../../../math/src/vector/vectorTuple.ts'
import { MISS, type Hit } from '../rays/sceneTrace/sceneTraceHit.fixture.ts'
import { REFLECTION_FATES } from './censusWgsl.ts'
import { REFLECTION_COUNTS } from './constants.ts'
import { REFLECTION_SCENE_TRACE_HARDWARE_WGSL } from './sceneTraceHardware.ts'

const HIT: Hit = { ...MISS, hit: true, distance: 2.5, placement: 7, object: 9, normal: [0, 1, 0] }

/** The biases of the view (`ReflectionView.hardware`): 1 mm along the ray, 1 mm off the surface, 8 cm of pullback, 10 cm of depth bias. */
const HARDWARE = [0.001, 0.001, 0.08, 10]

/** What the stage asks and answers: `trace` the scene trace's answer, `complete` whether it was whole, `light` what the cards give the hit. */
function stage(
  options: {
    trace?: Hit
    complete?: boolean
    light?: Vec3
    traces?: boolean
    longest?: number
    hardware?: number[]
  } = {},
) {
  const {
    trace = MISS,
    complete = true,
    light = [1, 2, 3],
    traces = true,
    longest = 200,
    hardware = HARDWARE,
  } = options
  const asked: { ray?: Record<string, unknown>; cards?: unknown[]; seen?: unknown[] } = {}
  const flags = traces ? REFLECTION_COUNTS.REFLECTION_SCENE_TRACES : 0
  const run = shaderRun<{
    reflectionSceneTrace: (
      P: Vec3,
      N: Vec3,
      lobe: object,
      begin: number,
      coord: number[],
      cone: number,
      firstPerson: boolean,
    ) => { answer: { color: Vec3; hit: boolean; distance: number }; open: boolean }
    reflectionLobeOf: (R: Vec3, alpha: number, lobe: number[]) => object
    reflectionDistantStart: (P: Vec3, R: Vec3, stop: number) => number
    testFate: () => number
    testWork: () => number
  }>(
    `${wgslModule(REFLECTION_SCENE_TRACE_HARDWARE_WGSL)}
fn testFate()->u32{return reflectionFate;}
fn testWork()->u32{return reflectionWork;}`,
    ['reflectionSceneTrace', 'reflectionLobeOf', 'reflectionDistantStart', 'testFate', 'testWork'],
    {
      reflectionView: { hardware, march: [0, 0, 0, longest], scene: [0, 0, flags, 0] },
      reflectionDone: (bit: number) =>
        (flags & bit) !== 0 || bit === REFLECTION_COUNTS.REFLECTION_HI_RES_SURFACE,
      reflectionFate: 0,
      reflectionWork: 0,
      reflectionOrigin: [0, 0, 0],
      view: { display: [0, 10, 0, 0] },
      stParams: { cullRadius: 300 },
      stTrace: (traced: Record<string, unknown>) => ((asked.ray = traced), trace),
      stSteps: 9,
      stComplete: complete,
      scHitPlacement: (object: number) => object + 100,
      scPlacementMeshCards: (instance: number) => instance + 1000,
      scEvaluateMeshCards: (...args: unknown[]) => ((asked.cards = args), { radiance: light }),
      reflectionHitSpread: (cone: number) => cone,
      reflectionSeenAt: (...args: unknown[]) => ((asked.seen = args), args[0]),
    },
  )
  const walk = (begin = 0, cone = 0.05, normal: Vec3 = [0, 1, 0], firstPerson = false) => {
    const lobe = run.reflectionLobeOf([1, 0, 0], 0, [0, 0, 0, 0])
    const out = run.reflectionSceneTrace([11, 2, 3], normal, lobe, begin, [5, 6], cone, firstPerson)
    return { ...out, fate: REFLECTION_FATES[run.testFate()], work: run.testWork() }
  }
  return Object.assign(walk, { asked, run })
}

test('the ray goes in the eye’s frame, off the surface by the normal bias as far as it leans on it, passing the translucent, culling the back faces and meeting the first-person stand-ins', () => {
  const walk = stage({ trace: HIT })
  walk()
  const traced = walk.asked.ray as Record<string, unknown>
  // The ray along +x leans not at all on a normal along +y: the origin is the surface point, less the eye [10, 0, 0].
  assert.deepEqual(
    [traced.origin, traced.direction, traced.flags],
    [[1, 2, 3], [1, 0, 0], 16 | 8 | 64],
  )
  // Along the normal it leans fully: 1 mm off the surface.
  walk(0, 0.05, [1, 0, 0])
  const leaning = walk.asked.ray as { origin: Vec3 }
  assert.ok(Math.abs(leaning.origin[0] - 1.001) < 1e-6, `${leaning.origin}`)
  assert.deepEqual(leaning.origin.slice(1), [2, 3])
})

test('a ray meets the stand-ins of first-person objects unless it is cast from a first-person pixel', () => {
  const MEET_WORLD_SPACE = 64
  const other = stage({ trace: HIT })
  other()
  // The translucent passed (16), the back faces culled (8), the stand-ins met (64).
  assert.equal(other.asked.ray!.flags, 16 | 8 | MEET_WORLD_SPACE)
  const first = stage({ trace: HIT })
  first(0, 0.05, [0, 1, 0], true)
  assert.equal(first.asked.ray!.flags, 16 | 8)
})

test('the ray goes from where the screen stopped knowing it less the pullback, never before its bias, to the longest ray', () => {
  const near = stage({ trace: HIT })
  near(0)
  assert.deepEqual(
    [near.asked.ray!.tMin, near.asked.ray!.tMax],
    [0.001, 200],
    'from the surface: the bias',
  )
  const far = stage({ trace: HIT })
  far(3)
  assert.ok(Math.abs((far.asked.ray!.tMin as number) - (3 - 0.08)) < 1e-6)
  // Nearer than the pullback, the bias holds it.
  const close = stage({ trace: HIT })
  close(0.05)
  assert.equal(close.asked.ray!.tMin, 0.001)
  // To the longest ray, wherever the screen stopped knowing it.
  const longest = stage({ trace: HIT })
  longest(4)
  assert.equal(longest.asked.ray!.tMax, 200)
})

test('a hit answers the light of the cards of its object at its point, over the ray’s cone at its distance, with the sampling depth bias', () => {
  const walk = stage({ trace: HIT })
  const found = walk(0, 0.02)
  assert.equal(found.fate, 'hit')
  assert.deepEqual([found.answer.hit, found.open, found.work], [true, false, 9])
  assert.deepEqual(found.answer.color, [1, 2, 3])
  assert.ok(Math.abs(found.answer.distance - 2.5) < 1e-5, `${found.answer.distance}`)
  const [cards, at, normal, radius, bias, hiRes, coord] = walk.asked.cards as [
    number,
    Vec3,
    Vec3,
    number,
    number,
    boolean,
    number[],
  ]
  // The object the trace named, the table of instances and the cache's placement in turn.
  assert.equal(cards, 1109)
  // Centimetres: the point 2.5 m along the ray from [11, 2, 3] (the normal bias along y being nothing for this ray), the cone 0.02 of it.
  assert.deepEqual(at, [1350, 200, 300])
  assert.deepEqual(normal, [0, 1, 0])
  assert.ok(Math.abs(radius - 0.02 * 250) < 1e-3, `${radius}`)
  assert.deepEqual([bias, hiRes, coord], [10, true, [5, 6]])
})

test('a hit no card lights is black, a hit all the same; a trace that stopped holding no hit is a black hit, one that held a hit gives the cards’ light', () => {
  const dark = stage({ trace: HIT, light: [0, 0, 0] })(0)
  assert.deepEqual([dark.fate, dark.answer.hit, dark.answer.color], ['hit', true, [0, 0, 0]])
  const stopped = stage({ trace: HIT, complete: false })(0)
  assert.deepEqual(
    [stopped.fate, stopped.answer.hit, stopped.answer.color, stopped.open],
    ['hit', true, [1, 2, 3], false],
    'a stopped trace that held a hit brings the cards’ light',
  )
  assert.ok(Math.abs(stopped.answer.distance - 2.5) < 1e-5, `${stopped.answer.distance}`)
  const nothing = stage({ trace: MISS, complete: false })(0)
  assert.deepEqual(
    [nothing.fate, nothing.answer.hit, nothing.answer.color, nothing.open],
    ['hit', true, [0, 0, 0], false],
  )
  assert.equal(nothing.answer.distance, 200, 'at the end of the ray')
})

test('a ray that hits nothing leaves the scene', () => {
  const open = stage({ trace: MISS })(0)
  assert.equal(open.fate, 'open')
  assert.deepEqual([open.answer.hit, open.open, open.work], [false, true, 9])
  // A ray the screen stopped knowing at a distance goes on past it, to what it hits there.
  const past = stage({ trace: HIT })(4)
  assert.equal(past.fate, 'hit')
  assert.deepEqual([past.answer.hit, past.open], [true, false])
})

test('with the scene traces off nothing is traced: a ray goes whole to what lies past the scene; one past the longest ray too', () => {
  const off = stage({ trace: HIT, traces: false })
  const walked = off(0)
  assert.equal(walked.fate, 'open')
  assert.deepEqual([walked.answer.hit, walked.open, walked.work], [false, true, 0])
  assert.equal(off.asked.ray, undefined)
  const past = stage({ trace: HIT })
  const ended = past(300)
  assert.deepEqual([ended.open, ended.work, past.asked.ray], [true, 0, undefined])
})

test('the far trace of a ray that left the scene begins where it leaves the sphere of the culling radius about the eye, 32/31 of it less 1/31 of the trace', () => {
  const { run } = stage()
  // The eye at [10, 0, 0], a ray from it along +x: it leaves the sphere of 300 m at 300.
  const start = run.reflectionDistantStart([10, 0, 0], [1, 0, 0], 2000)
  assert.ok(Math.abs(start - ((32 / 31) * 300 - 2000 / 31)) < 1e-3, `${start}`)
  // A trace shorter than the 1/31 it is pulled back by leaves no start before the surface.
  assert.equal(run.reflectionDistantStart([10, 0, 0], [1, 0, 0], 10000), 0)
  // A surface outside the sphere starts at itself.
  assert.equal(run.reflectionDistantStart([1000, 0, 0], [1, 0, 0], 2000), 0)
})
