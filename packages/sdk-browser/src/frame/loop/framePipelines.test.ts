// What enters the scene after preparation — a resolve class a material changed into, a surface
// that came to emit, a guide shown — has its pipelines asked at the next frame entry, compiled off
// the thread while the frame is held on them, the previous image shown: no frame compiles one, and
// each is the pipeline the frame would have compiled itself, descriptor for descriptor.
import test from 'node:test'
import assert from 'node:assert/strict'
import { holdWebgpuFrame } from './hold.ts'
import { advanceImageNumber } from './imageNumber.ts'
import { askFramePipelines } from './framePipelines.ts'
import { deviceAnswer, deviceAnswering } from './deviceAnswer.ts'
import { drawsEveryImage } from './everyImage.ts'
import { askBounce, setWebgpuBounce } from '../prepare/bounce.ts'
import { unsettledMask, unsettledReasons } from './unsettled.ts'
import { preparedPipeline } from '../../lighting/deferred/fullscreen.ts'
import { drawFinalImage } from './hold.fixture.ts'
import { armed } from './framePipelines.fixture.ts'

test('a frame entry holds the image while a pipeline its frame binds compiles, and draws once it landed', async () => {
  const { rt, device, compiled, land } = armed()
  const pipeline = preparedPipeline(device, {
    label: 'test pipeline',
    layout: 'auto',
    vertex: {} as never,
  }).ask()
  assert.equal(holdWebgpuFrame(rt, device), true, 'held: the previous image shown')
  assert.equal(rt.run.frameHeld, false, 'on an answer, not as a still frame')
  const answer = deviceAnswer(rt)
  assert.ok(answer, 'the loop waits for the compile')
  await land()
  await answer
  assert.equal(pipeline.ready, true)
  drawFinalImage(rt, device)
  assert.equal(holdWebgpuFrame(rt, device), true)
  assert.equal(rt.run.frameHeld, true, 'landed: a still frame again')
  assert.equal(compiled.sync, 0, 'no frame compiled it')
})

test('a stable scene whose pipelines are compiled stays held across the frame entries: asking costs nothing and moves nothing', async () => {
  const { rt, device, compiled, land } = armed()
  const pipeline = preparedPipeline(device, {
    label: 'test pipeline',
    layout: 'auto',
    vertex: {} as never,
  }).ask()
  await land()
  assert.equal(pipeline.ready, true)
  drawFinalImage(rt, device)
  const frame = rt.run.frame,
    made = compiled.async
  for (let entry = 0; entry < 5; entry++) {
    askFramePipelines(rt)
    // Asked again, a compiled pipeline starts no compile and holds no frame.
    pipeline.ask()
    assert.equal(deviceAnswer(rt), undefined, 'no answer is owed')
    assert.equal(holdWebgpuFrame(rt, device), true)
    assert.equal(rt.run.frameHeld, true, 'a still frame, not an answer')
    advanceImageNumber(rt.run, true)
  }
  assert.equal(rt.run.frame, frame + 5, 'every entry is a held frame')
  assert.equal(compiled.async, made, 'no compile was started by the entries')
  assert.equal(drawsEveryImage(rt), false, 'nothing draws the quiet view again')
})

test('the bounce is asked only once its inputs exist, and a missing one records no refusal', () => {
  const { rt, device } = armed()
  Object.assign(rt.bounce, { wanted: true, reason: null, pending: undefined })
  Object.assign(rt.lights.store, { unlit: false, count: 1 })
  // The lamp is not on the GPU yet: nothing is rigged, nothing refused for good.
  askBounce(rt, device)
  assert.equal(rt.bounce.pending, undefined)
  assert.equal(rt.bounce.reason, null)
  // On the GPU, and no cut yet to size the placements: still nothing made, still no refusal.
  Object.assign(rt.lights, { buffer: {} })
  Object.assign(rt.gpu, { deferred: {} })
  askBounce(rt, device)
  assert.equal(rt.bounce.pending, undefined)
  assert.equal(rt.bounce.reason, null)
})

test('a bounce switched off while its probes are made no longer keeps the image drawn', () => {
  const { rt } = armed()
  Object.assign(rt.bounce, {
    wanted: true,
    probes: undefined,
    reason: null,
    pending: Promise.resolve(),
  })
  assert.ok(
    unsettledReasons(unsettledMask(rt)).includes('bounceProbes'),
    'rigging: the image is drawn',
  )
  assert.equal(deviceAnswering(rt), false, 'and no frame is held on the probes')
  setWebgpuBounce(rt, false)
  assert.ok(!unsettledReasons(unsettledMask(rt)).includes('bounceProbes'), 'switched off: no wait')
})
