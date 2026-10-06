// The view ahead (#921): it reads the eye's velocity smoothed (STR-10) over a horizon that grows
// with the pages' round trip (STR-09). What the image reads of the motion — the speed of the
// adaptive threshold, the velocity, the turn — is the one of before, and a still camera still
// sends no view ahead at all.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readCameraMotion } from './motion.ts'
import type { CameraMotion } from './motion.ts'
import type { EngineCamera } from './engineCamera.ts'
import { aheadViewOf } from '../gpu/core/aheadView.ts'
import * as G from '../host/graph/graph.fixture.ts'
import { engineCamera as engineCameraOf } from './camera.fixture.ts'
import { random as reproducible } from '../page/cut/cutRuleChecks.fixture.ts'
import { PREFETCH_HORIZON_MS, prefetchHorizonMs } from '../backend/common.ts'
import { restartCameraMotion } from './motion.fixture.ts'
import { AHEAD_SMOOTHING_MS } from './motionSmoothing.ts'
import { MAX_PREFETCH_HORIZON_MS } from '../backend/prefetchHorizon.ts'

/** A bare engine camera: the eye and the way back are all the motion reads. */
const pose = (eye: number[], back = [0, 0, 1]) => {
  const view = new Float64Array(16)
  ;[view[2], view[6], view[10]] = back
  return { eye: Float64Array.from(eye), view } as unknown as EngineCamera
}

test('what the image reads never depends on the view ahead, on random paths', () => {
  const random = reproducible(921)
  const special = [0, -0, NaN, Infinity, -Infinity, 1e-300, 1e300]
  const pick = () => (random() < 0.1 ? special[Math.floor(random() * 7)] : random() * 200 - 100)
  // `scrambled` has its velocity ahead overwritten before every read: the speed of the adaptive
  // threshold, the velocity and the turn read the same, bit for bit.
  const motion: CameraMotion = {},
    scrambled: CameraMotion = {}
  let clock = 0
  for (let frame = 0; frame < 5000; frame++) {
    if (random() < 0.01) {
      restartCameraMotion(motion)
      restartCameraMotion(scrambled)
    }
    if (random() < 0.5) scrambled.ahead = Float64Array.of(pick(), pick(), pick())
    else scrambled.ahead = undefined
    const still = random() < 0.2 && motion.last
    const eye = still ? [...motion.last!] : [pick(), pick(), pick()]
    const turn = random() * Math.PI
    const cam = pose(eye, still ? [...motion.lastBack!] : [Math.sin(turn), 0, Math.cos(turn)])
    clock += random() < 0.02 ? special[frame % special.length] : random() * 40
    const speed = readCameraMotion(cam, motion, clock)
    assert.ok(Object.is(speed, readCameraMotion(cam, scrambled, clock)), `frame ${frame}`)
    assert.deepEqual([...motion.velocity!], [...scrambled.velocity!])
    assert.ok(Object.is(motion.turn, scrambled.turn))
    if (still) assert.deepEqual([...motion.ahead!], [...motion.velocity!], 'still: as it is')
  }
})

test('a still eye reads no velocity ahead; one that starts reads its own; a steady one keeps it', () => {
  const motion: CameraMotion = {}
  readCameraMotion(pose([0, 0, 0]), motion, 0)
  assert.deepEqual([...motion.ahead!], [0, 0, 0], 'the first read is at rest')
  readCameraMotion(pose([0, 0, 0]), motion, 16)
  assert.deepEqual([...motion.ahead!], [0, 0, 0])
  readCameraMotion(pose([4, 0, 0]), motion, 116)
  assert.deepEqual([...motion.ahead!], [40, 0, 0], 'a start waits for no filter')
  readCameraMotion(pose([8, 0, 0]), motion, 216)
  assert.deepEqual([...motion.ahead!], [40, 0, 0], 'a steady velocity is its own average')
  readCameraMotion(pose([8, 0, 0]), motion, 232)
  assert.deepEqual([...motion.ahead!], [0, 0, 0], 'a stop leaves nothing ahead')
  readCameraMotion(pose([9, 0, 0]), motion, 332)
  restartCameraMotion(motion)
  assert.equal(motion.ahead, undefined)
})

test('a frame of jitter moves the velocity ahead by its share of the filter, no more', () => {
  const motion: CameraMotion = {}
  readCameraMotion(pose([0, 0, 0]), motion, 0)
  readCameraMotion(pose([1, 0, 0]), motion, 100)
  // The next frame reads twice the speed: the view ahead takes 1 - e^(-dt/τ) of the change.
  readCameraMotion(pose([3, 0, 0]), motion, 200)
  const share = 1 - Math.exp(-100 / AHEAD_SMOOTHING_MS)
  assert.ok(Math.abs(motion.ahead![0] - (10 + 10 * share)) < 1e-9)
  assert.equal(motion.velocity![0], 20, 'the image still reads the raw velocity')
  // A clock that goes back, or a velocity that is not finite, keeps nothing of the past.
  readCameraMotion(pose([4, 0, 0]), motion, 150)
  assert.deepEqual([...motion.ahead!], [...motion.velocity!])
  readCameraMotion(pose([Infinity, 0, 0]), motion, 250)
  readCameraMotion(pose([5, 0, 0]), motion, 350)
  assert.deepEqual([...motion.ahead!], [...motion.velocity!])
})

test('no round trip measured keeps the published horizon; a measured one adds, up to the cap', () => {
  for (const none of [undefined, 0, -0, -5, NaN, -Infinity])
    assert.equal(prefetchHorizonMs(none), PREFETCH_HORIZON_MS, String(none))
  assert.equal(prefetchHorizonMs(60), PREFETCH_HORIZON_MS + 60)
  assert.equal(prefetchHorizonMs(Infinity), MAX_PREFETCH_HORIZON_MS)
  assert.equal(prefetchHorizonMs(1e9), MAX_PREFETCH_HORIZON_MS)
})

test('the view ahead at the published horizon is the one of before; a longer one looks further', () => {
  const camera = G.perspectiveCamera(55, 16 / 9, 0.1, 200)
  camera.position.set(0, 0, 10)
  camera.updateMatrixWorld(true)
  const cam = engineCameraOf(camera)
  const still: CameraMotion = { velocity: new Float64Array(3), turn: 0, horizonMs: 330 }
  assert.equal(aheadViewOf(cam, still), null, 'still: none')
  const motion: CameraMotion = { velocity: Float64Array.of(40, 0, 0), turn: 0.5 }
  const published = aheadViewOf(cam, motion)!
  for (const none of [undefined, 0, NaN])
    assert.deepEqual(aheadViewOf(cam, { ...motion, horizonMs: prefetchHorizonMs(none) }), published)
  // The eye moved by `v·h` sees the world moved back by it: the view's translation says how far.
  const further = aheadViewOf(cam, { ...motion, horizonMs: prefetchHorizonMs(250) })!
  assert.ok(Math.abs(published.view[12] + 40 * 0.25) < 1e-4)
  assert.ok(Math.abs(further.view[12] + 40 * 0.5) < 1e-4)
  // The smoothed velocity, when there is one, is what the view ahead extrapolates.
  const smoothed = aheadViewOf(cam, { ...motion, ahead: Float64Array.of(20, 0, 0) })!
  assert.ok(Math.abs(smoothed.view[12] + 20 * 0.25) < 1e-4)
})

/** The engine camera at `x` on the x axis, ten units up, looking down -z: its view ahead's
 *  translation along x is minus how far ahead it looks. */
const along = (x: number) => {
  const camera = G.perspectiveCamera(55, 16 / 9, 0.1, 200)
  camera.position.set(x, 0, 10)
  camera.updateMatrixWorld(true)
  return engineCameraOf(camera)
}
/** Reads the camera along a path of `[ms, x]` frames; returns how far ahead its view looks, 0 for
 *  none. */
const lookAhead = (motion: CameraMotion, path: number[][]) => {
  for (const [ms, x] of path) readCameraMotion(along(x), motion, ms)
  const ahead = aheadViewOf(along(path.at(-1)![1]), motion)
  return ahead ? -ahead.view[12] : 0
}
const frames = (from: number, count: number, x: (ms: number) => number) =>
  Array.from({ length: count }, (_, i) => [from + 16 * i, x(from + 16 * i)])

test('a one-frame jump sends the view ahead no further than the jump, and none once still', () => {
  // From rest: before, the jump over one 16 ms frame was extrapolated over the whole horizon, about
  // fifteen times as far.
  const still: CameraMotion = {}
  const jump = lookAhead(still, [...frames(0, 3, () => 0), [48, 10]])
  assert.ok(jump > 0 && jump <= 10 + 1e-3, `from rest: ${jump}`)
  assert.equal(lookAhead(still, [[64, 10]]), 0, 'the next still frame looks nowhere ahead')
  // In the middle of a steady walk at one unit a second: the jump is a cut too.
  const walking: CameraMotion = {}
  const walk = frames(0, 20, (ms) => ms / 1000)
  const leap = lookAhead(walking, [...walk, [320, 10.304]])
  assert.ok(leap > 0 && leap <= 10 + 1e-3, `while walking: ${leap}`)
  assert.ok(lookAhead(walking, [[336, 10.32]]) < 0.1, 'and the walk that resumes starts over')
})

test('a steady motion is extrapolated over the whole horizon, one that starts over its time so far', () => {
  const motion: CameraMotion = {}
  const started = lookAhead(
    motion,
    frames(0, 2, (ms) => (40 * ms) / 1000),
  )
  assert.ok(Math.abs(started - 40 * 0.016) < 1e-4, `one frame in: ${started}`)
  const steady = lookAhead(
    motion,
    frames(32, 20, (ms) => (40 * ms) / 1000),
  )
  assert.ok(Math.abs(steady - (40 * PREFETCH_HORIZON_MS) / 1000) < 1e-3, `steady: ${steady}`)
})

test('a turn that reverses at the same rate is a cut: the view ahead turns no further than it', () => {
  /** The engine camera at the origin, ten units up, looking down -z turned by `yaw` radians. */
  const yawed = (yaw: number) => {
    const camera = G.perspectiveCamera(55, 16 / 9, 0.1, 200)
    camera.position.set(0, 0, 10)
    camera.lookAt(10 * Math.tan(yaw), 0, 0)
    camera.updateMatrixWorld(true)
    return engineCameraOf(camera)
  }
  const motion: CameraMotion = {}
  for (let i = 0; i <= 20; i++) readCameraMotion(yawed(0.016 * i), motion, 16 * i)
  assert.ok(motion.turnSteadyMs! > 300, 'a steady turn holds')
  // Back the other way, one frame, at the same rate.
  readCameraMotion(yawed(0.016 * 19), motion, 16 * 21)
  assert.ok(Math.abs(motion.turn! - 1) < 1e-3, 'the same rate')
  assert.equal(motion.turnSteadyMs, 16, 'held one frame only')
})
