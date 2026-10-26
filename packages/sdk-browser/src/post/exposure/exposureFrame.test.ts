// The exposure of an image, driven through the frame's own entry (`encodeExposure`) on a fake
// device: it adapts on the world's clock the engine is handed — a world that holds still, a world in
// slow motion, a page that was away — and not on the wall clock; an exposure the engine holds (a
// number, the manual method) is written into the meter's buffer each image, so that a switch back to
// a measuring method starts from it over a normal frame.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { EXPOSURE_RULES } from '../../../../sdk-core/src/contracts/exposureOptions.ts'
import { resolveSettings } from '../../../../sdk-core/src/contracts/settingRules.ts'
import { takeGraphClocks, newGraphClocks } from '../../materials/graph/clocks.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import type { SceneChain } from '../filters/sceneChain.ts'
import { EXPOSURE_AT, encodeExposure } from './frame.ts'
import { METER_PARAMS, SHOWN_AT } from './meterLayout.ts'
import { HDR_FORMAT } from '../../scene/targetFormats.ts'
import { filterPrograms } from '../filters/filterPrograms.ts'
import { askExposurePrograms, meterPrograms } from './meterPrograms.ts'
import { beginPreExposure } from './pre.ts'
import { createTaaFrameState } from '../taa/frameState.ts'
import { AT, within } from './meter.fixture.ts'

/** A lit view as the exposure reads it: its settings over the defaults, its scene's exposure, the
 *  world's clock when it has one, the image clocks `takeGraphClocks` fills each image. */
function viewOf(
  device: GPUDevice,
  options: { exposure?: unknown; worldClock?: () => number; settings?: object } = {},
) {
  const { exposure = 'auto', worldClock, settings = {} } = options
  return {
    lights: { store: { environment: { exposure }, unlit: false } },
    gpu: {
      deferred: {
        uniform: device.createBuffer({
          size: 1024,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
        }),
      },
    },
    context: { ...resolveSettings(EXPOSURE_RULES, {}), ...settings, worldClock },
    run: {
      diagnostic: 'beauty',
      graphClocks: newGraphClocks(),
      gate: { temporalRevision: 0 },
    },
    views: { active: { overrides: { post: true } } },
  } as unknown as WebgpuPagesRuntime
}

/** One image of the view at wall time `wall` ms: the clocks taken as the frame takes them, the
 *  pre-exposure begun, the exposure encoded. */
function image(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  wall: number,
  {
    size = [1920, 1080],
    view = {} as GPUTextureView,
    scene = { need: () => undefined, view: () => ({}) } as unknown as SceneChain,
  } = {},
) {
  const encoder = device.createCommandEncoder()
  takeGraphClocks(rt.run.graphClocks, rt.context.worldClock, wall)
  const pre = beginPreExposure(rt)
  const settings = resolveSettings(EXPOSURE_RULES, rt.context)
  encodeExposure(rt, device, encoder, scene, view, size, false, settings, pre)
  return pre
}

/** The meter's buffers on the fake device, by what they hold (their sizes tell them apart). */
function metersOf(buffers: { size: number; data: Uint8Array }[]) {
  const words = (size: number) => {
    const found = buffers.find((buffer) => buffer.size === size)!
    return new Float32Array(found.data.buffer, found.data.byteOffset, size / 4)
  }
  return {
    uniform: () => words(METER_PARAMS.words * 4),
    exposure: () => words(32),
  }
}

async function readyDevice() {
  const made = fakeDevice()
  askExposurePrograms(made.device, true)
  const programs = meterPrograms(made.device)
  await Promise.all(
    [programs.measure, programs.basic, programs.setup, programs.adapt].map((p) => p.prepare()),
  )
  await filterPrograms(made.device).prepare([
    ['halve', HDR_FORMAT],
    ['halveWide', HDR_FORMAT],
  ])
  return made
}

test('the exposure adapts on the world’s clock: a world held still moves it by none, slow motion by its own seconds', async () => {
  const { device, buffers } = await readyDevice()
  let world = 10
  const rt = viewOf(device, { worldClock: () => world })
  const meters = metersOf(buffers)
  // The wall clock leaps five seconds at each image while the world lived 16 ms, none, 4 ms.
  const seconds: number[] = []
  for (const [k, lived] of [0, 0.016, 0, 0.004].entries()) {
    world += lived
    image(rt, device, 5000 * (k + 1))
    seconds.push(meters.uniform()[AT.speeds + 3])
  }
  assert.deepEqual(seconds, [0, 0.016, 0, 0.004].map(Math.fround))
})

test('an engine with no world adapts on the image clock, the wall clock taken once an image', async () => {
  const { device, buffers } = await readyDevice()
  const rt = viewOf(device)
  const meters = metersOf(buffers)
  const seconds: number[] = []
  for (const wall of [1000, 1016, 1016, 1048]) {
    image(rt, device, wall)
    seconds.push(meters.uniform()[AT.speeds + 3])
  }
  assert.deepEqual(seconds, [0, 0.016, 0, 0.032].map(Math.fround))
})

test('a held exposure is written into the exposure buffer each image and a switch back adapts from it', async () => {
  const { device, buffers, copies } = await readyDevice()
  let world = 0
  const rt = viewOf(device, { worldClock: () => world })
  const meters = metersOf(buffers)
  const speeds = () => meters.uniform()[AT.speeds + 3]
  const jump = () => meters.uniform()[AT.response + 3]
  // Automatic for two images, then the manual method for a world's ten seconds, then automatic.
  image(rt, device, 0)
  world = 0.016
  image(rt, device, 16)
  assert.equal(jump(), 0, 'a step, not a jump')
  Object.assign(rt.context, { exposureMethod: 'manual' })
  for (const at of [10, 10.016]) {
    world = at
    const pre = image(rt, device, at * 1000)
    // f/4, 1/60 s, ISO 100: white point 960, the bias 1: 2/960 over the pre-exposure, the grey of
    // the local bias alone (the bias cancels in a manual exposure's grey).
    const held = pre.held!
    within(held.exposure, 2 / 960, 1e-9, 'the manual exposure')
    const buffer = meters.exposure()
    within(buffer[0], 2 / 960, 1e-6, 'the exposure')
    within(buffer[1], 2 / 960, 1e-6, 'the one asked')
    within(buffer[3], 2, 1e-6, 'the compensation')
    within(buffer[SHOWN_AT / 4], held.exposure / pre.now, 1e-6, 'the scale shown')
    within(buffer[SHOWN_AT / 4 + 2], Math.log2(0.18), 1e-6, 'the middle grey')
    assert.equal(buffer[SHOWN_AT / 4 + 1], 1, 'no local gain')
  }
  // The scale shown reached the composition's view and the grey the finishing's source.
  const view = buffers.find((buffer) => buffer.size === 1024)!
  const shown = new Float32Array(view.data.buffer, view.data.byteOffset + EXPOSURE_AT, 1)[0]
  within(shown, meters.exposure()[SHOWN_AT / 4], 1e-9, 'copied to the view')
  assert.ok(copies.some((copy) => copy.fromOffset === SHOWN_AT && copy.toOffset === EXPOSURE_AT))
  // Back to the histogram, a world's 16 ms later: a normal frame from the held exposure.
  Object.assign(rt.context, { exposureMethod: 'histogram' })
  world = 10.032
  image(rt, device, 10032)
  within(speeds(), 0.016, 1e-6, 'the seconds since the last image, held or not')
  assert.equal(jump(), 0, 'no jump: the exposure moves from the one shown')
  within(meters.exposure()[0], 2 / 960, 1e-9, 'the update starts from the held exposure')
})

test('a fixed exposure is the number itself in the buffer, its grey the local bias’s alone', async () => {
  const { device, buffers } = await readyDevice()
  const rt = viewOf(device, { exposure: 0.25, settings: { localExposureMiddleGreyBias: 1 } })
  const pre = image(rt, device, 0)
  const buffer = metersOf(buffers).exposure()
  assert.equal(pre.held!.exposure, 0.25)
  within(buffer[0], 0.25, 1e-9, 'the exposure')
  within(buffer[3], 1, 1e-9, 'bias and curve are ignored')
  within(buffer[SHOWN_AT / 4 + 2], Math.log2(0.18 * 2), 1e-6, 'the grey')
})

test('a held exposure that does not change does no work on the GPU: no write, no copy to the readback, no mapping; the meter knows it at once', async () => {
  const { device, buffers, writes, copies } = await readyDevice()
  const rt = viewOf(device, { exposure: 0.25 })
  const exposure = () => buffers.find((buffer) => buffer.size === 32)!
  const staged = () =>
    copies.filter(({ to }) => String((to as { label?: string }).label).includes('readback'))
  const writesTo = (buffer: object) => writes.filter((write) => write.buffer === buffer)
  const pre = image(rt, device, 0)
  const meter = rt.gpu.exposure!
  assert.equal(meter.last, 0.25, 'its exposure the CPU’s own, with no readback to wait for')
  assert.equal(meter.moving, false, 'settled: nothing to draw again for')
  assert.equal(staged().length, 0, 'no copy to the readback')
  const [first, copiedFirst] = [writesTo(exposure()).length, copies.length]
  for (let k = 1; k <= 5; k++) image(rt, device, 16 * k)
  assert.equal(writesTo(exposure()).length, first, 'the buffer holds it: five images write nothing')
  assert.equal(copies.length - copiedFirst, 5, 'one copy an image: the scale shown into the view')
  assert.equal(staged().length, 0, 'and none to the readback')
  assert.equal(
    buffers.some(({ label }) => String(label).includes('readback')),
    false,
    'no staging buffer is made',
  )
  // A change writes what changed, once: the bias moves the compensation and the grey, not the exposure and its mean.
  Object.assign(rt.context, { localExposureMiddleGreyBias: 1 })
  image(rt, device, 100)
  const changed = writesTo(exposure()).slice(first)
  assert.equal(changed.length, 1)
  assert.ok(
    (changed[0].size ?? 0) <= 8 && (changed[0].offset ?? 0) >= 0,
    'in one write, words only',
  )
  within(
    new Float32Array(exposure().data.buffer, exposure().data.byteOffset, 8)[SHOWN_AT / 4 + 2],
    Math.log2(0.18 * 2),
    1e-6,
    'the grey',
  )
  assert.ok(pre.held, 'held')
})

test('the pre-exposure of the image before is kept once, on the pre-exposure: the ratio the temporal pass brings its history by', async () => {
  const { device } = await readyDevice()
  const rt = viewOf(device, { exposure: 0.25 })
  const first = image(rt, device, 0)
  assert.equal(first.previous, 1, 'none before the first')
  const [now] = [first.now]
  ;(rt.lights.store.environment as { exposure: number }).exposure = 0.5
  const second = image(rt, device, 16)
  assert.equal(second.previous, now, 'the image before’s number, kept once')
  assert.notEqual(second.now, now, 'the scene’s exposure moved')
  assert.equal(
    'previousPreExposure' in createTaaFrameState(),
    false,
    'the temporal pass keeps none of its own',
  )
})

test('a measuring image rewrites the exposure buffer: the held exposure after it is written again, though its words are what they were', async () => {
  const { device, buffers, writes } = await readyDevice()
  const rt = viewOf(device, { exposure: 'auto' })
  const exposure = (): object => buffers.find((buffer) => buffer.size === 32)!
  const writesTo = () => writes.filter((write) => write.buffer === exposure())
  Object.assign(rt.context, { exposureMethod: 'manual' })
  image(rt, device, 0)
  const held = writesTo().length
  image(rt, device, 16)
  assert.equal(writesTo().length, held, 'held twice, written once')
  Object.assign(rt.context, { exposureMethod: 'histogram' })
  image(rt, device, 32)
  Object.assign(rt.context, { exposureMethod: 'manual' })
  image(rt, device, 48)
  assert.equal(
    writesTo().length,
    held + 1,
    'the update rewrote the buffer: the held words go up again',
  )
})

test('leaving the basic method forgets the groups over its grid: none holds its texture, a return makes them again', async () => {
  const { device, bindGroups } = await readyDevice()
  const rt = viewOf(device)
  const measureGroups = () =>
    bindGroups.filter(({ layout }) => layout === meterPrograms(device).measureLayout).length
  // The scene's chain the basic method draws its grid from: the quarter-size level, 512 × 256.
  const scene = {
    need: () => undefined,
    view: () => ({}) as GPUTextureView,
    size: () => [512, 256],
  } as unknown as SceneChain
  // The histogram reads the chain's half-size image: the same one, one group.
  const half = {} as GPUTextureView
  const halved = { need: () => undefined, view: () => half } as unknown as SceneChain
  image(rt, device, 0, { scene: halved })
  image(rt, device, 16, { scene: halved })
  assert.equal(measureGroups(), 1, 'the same image, one group')
  Object.assign(rt.context, { exposureMethod: 'basic' })
  image(rt, device, 32, { scene })
  assert.equal(measureGroups(), 2, 'the grid’s group')
  Object.assign(rt.context, { exposureMethod: 'histogram' })
  image(rt, device, 48, { scene: halved })
  // The cache was cleared on leaving: the histogram's image has a group made again, where a cache
  // that kept the grid's would have kept this one too.
  assert.equal(measureGroups(), 3, 'a group made again')
})
