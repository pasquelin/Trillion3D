import test from 'node:test'
import assert from 'node:assert/strict'
import { dropTaaHistory, taaConverged } from './landing.ts'
import { HISTORY_LAWS } from './historyWgsl.ts'
import { RAD2DEG } from '../../../../math/src/constants.ts'
import { IDENTITY_MATRIX4 } from '../../../../math/src/matrix/matrix4.ts'
import { taaRenderMatrix } from './frame.ts'
import { runtime } from './frame.fixture.ts'
import { TAA_SAMPLES } from './jitter.ts'
import type { TaaInputs } from './inputs.ts'
import { TAA_VIEW } from './bindingsWgsl.ts'
import { NO_VIEW_SET } from '../../../../sdk-core/src/world/camera/viewSet.ts'
import { EffectChain } from '../../../../sdk-core/src/world/effect/chain.ts'
import { effect } from '../../../../sdk-core/src/world/effect/index.ts'

/** The uniform's words a frame writes: whether the history describes nothing (a cut, none yet),
 *  and whether a placement moved. */
const CUT = TAA_VIEW.at.params,
  MOVED = CUT + 2

test("without accumulation this frame, the render matrix is the camera's and composition reads the lit image", () => {
  const { rt, cam, encoded, frame } = runtime()
  rt.capture.capturing = true
  assert.equal(frame(false), null)
  assert.equal(taaRenderMatrix(rt, cam), cam.viewProjection)
  assert.equal(encoded.length, 0)
  rt.capture.capturing = false
  rt.run.diagnostic = 'screen-error' as never
  assert.equal(frame(false), null)
  assert.equal(taaRenderMatrix(rt, cam), cam.viewProjection)
})

test('an accumulated frame advances jitter, writes the uniform and returns the written target', () => {
  const { rt, cam, temporal, velocity, encoded, frame, flags } = runtime()
  let u = frame(false)!
  assert.notEqual(taaRenderMatrix(rt, cam), cam.viewProjection, 'the matrix carries the jitter')
  assert.equal(encoded.length, 1)
  assert.equal((encoded[0] as TaaInputs).flags, flags, 'what the as-is share comes from')
  assert.equal(
    (encoded[0] as TaaInputs).normals,
    rt.vis.concatNrm,
    'the atlas a prism is solved by',
  )
  assert.equal(velocity.motion.resets, 1, 'the first frame has no history: poses are taken')
  // Without history the frame is a cut (`params.x`); the next one reads it, and nobody moved
  // (`params.z`).
  assert.equal(u[CUT], 1)
  u = frame(false)!
  assert.equal(u[CUT], 0)
  assert.equal(u[MOVED], 0)
  assert.deepEqual(velocity.motion.updates, [false], 'unchanged scene: no pose comparison')
  assert.equal(temporal.frame.sample, 2)
  // A scene change makes poses be compared, and a placement that moved is told to the pass.
  rt.run.gate.revisions.scene++
  velocity.motion.moved = true
  u = frame(false)!
  assert.deepEqual(velocity.motion.updates, [false, true])
  assert.equal(u[MOVED], 1)
  frame(false, false)
  assert.equal((encoded.at(-1) as TaaInputs).flags, undefined, 'no as-is pixel, no flags (OMB-11)')
})

test('the jitter runs on every image, a cut drops the history', () => {
  const { temporal, frame } = runtime()
  // Three moving frames: the jitter advances.
  for (let i = 0; i < 3; i++) frame(false)
  assert.equal(temporal.frame.sample, 3)
  frame(false)
  // A still frame: the history is read, the jitter rank runs on.
  const start = temporal.frame.sample
  let u = frame(true)!
  assert.equal(u[CUT], 0, 'the history is kept')
  assert.equal(temporal.frame.sample, start + 1, 'the jitter rank runs on')
  for (let k = 1; k < TAA_SAMPLES; k++) frame(true)
  assert.equal(temporal.frame.sample, start, 'the cycle turns on still images')
  // Something moves: history stays and mixes at its own share.
  u = frame(false)!
  assert.equal(u[CUT], 0)
  dropTaaHistory(temporal.frame)
  assert.equal(temporal.frame.hasHistory, false)
  assert.equal(temporal.frame.sample, 0)
})

test('motion restarts the convergence count: a still view after it holds once its own images fill the history', () => {
  const { rt, cam, temporal, frame } = runtime()
  const converged = () => taaConverged(temporal.frame, 64, 64)
  for (let i = 0; i < 30; i++) frame(true)
  assert.equal(temporal.frame.accumulated, 30, 'a still view counts every image')
  // The camera moves: the history is kept, its count restarts with this image.
  cam.viewProjection = Float64Array.from(IDENTITY_MATRIX4, (v, i) => (i === 12 ? 0.25 : v))
  frame(false)
  assert.equal(temporal.frame.accumulated, 1)
  assert.equal(temporal.frame.hasHistory, true)
  // Still again: never whole before the history holds its most samples of still images.
  let images = 1
  while (!converged()) {
    frame(true)
    images++
  }
  const { samples } = HISTORY_LAWS
  assert.ok(images >= samples, `${images} still images, at least ${samples}`)
  assert.equal(temporal.frame.sample, 0, 'held at the end of a jitter cycle')
  // A resource landing restarts it too.
  rt.run.gate.resourcesChanged()
  frame(true)
  assert.equal(temporal.frame.accumulated, 1)
})

test('a view that has a plane is drawn without jitter, whatever the project switch, the pass still accumulating', () => {
  const { rt, cam, temporal, frame } = runtime()
  const plane = Object.freeze({
    ...NO_VIEW_SET,
    clipPlane: [0, 0, 1, 2],
    jitters: false,
  }) as never
  cam.viewSet = plane
  for (let i = 0; i < 3; i++) {
    frame(false)
    assert.deepEqual(Array.from(temporal.frame.jitter), [0, 0], `image ${i}: no jitter`)
    assert.deepEqual(Array.from(taaRenderMatrix(rt, cam)), Array.from(cam.viewProjection))
  }
  assert.equal(temporal.frame.active, true, 'it still accumulates')
  // The same camera without its plane is jittered again.
  cam.viewSet = NO_VIEW_SET
  frame(false)
  assert.notDeepEqual(Array.from(temporal.frame.jitter), [0, 0])
})

test("the smallest object measured is the chain's motion blur's, in the stage's uniform and the pass's", () => {
  const { rt, cam, frame } = runtime()
  const { rates } = TAA_VIEW.at
  const sizes = () => [...frame(false)!.subarray(rates + 2, rates + 4)]
  // Half the projection's scale and the least radius squared: none left out without a blur.
  assert.deepEqual(sizes(), [0.5, 0])
  const blur = effect.motionBlur({ perObjectSize: 10 })
  Object.assign(rt.context, { effects: new EffectChain().add(blur) })
  // 10 % of the screen is a radius of 5 %, at the reference's 90 degrees (a scale of 1).
  assert.deepEqual(sizes(), [0.5, Math.fround(0.05 ** 2)])
  // A narrower view (a projection scale of 2) asks less: the radius follows the field of view
  // over 90 degrees.
  const projection = [...IDENTITY_MATRIX4]
  projection[0] = 2
  Object.assign(cam, { projection })
  const fov = (2 * Math.atan(0.5) * RAD2DEG) / 90
  assert.deepEqual(sizes(), [1, Math.fround((0.05 * fov) ** 2)])
  blur.perObjectSize = 0
  assert.deepEqual(sizes(), [1, 0])
})

test("the frame's tessellation reaches the stage's uniform and the pass's: the one word the rasters read", () => {
  const { rt, temporal, frame } = runtime()
  const { tessellation } = TAA_VIEW.at
  assert.equal(frame(false)![tessellation], 0, 'no displaced surface: the surfaces are flat')
  Object.assign(rt.vis.materialTable.displaced, { count: 1 })
  assert.equal(frame(false)![tessellation], 1)
  assert.equal(temporal.frame.tessellated, true, 'decided once, by the stage, for the pass')
  Object.assign(rt.context, { tessellation: false })
  assert.equal(frame(false)![tessellation], 0, 'the setting off draws them flat')
})
