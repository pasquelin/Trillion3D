// The sky module in the backend follows the live quality settings of the session each image: a
// setting written by the page, a preset or the editor reaches the sky light's capture and the
// clouds' passes, and the clouds are out while `cloudsOn` is off.
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveSettings } from '../../../../sdk-core/src/contracts/settingRules.ts'
import { skyAtQuality } from '../../../../sdk-core/src/modules/sky/descriptor.ts'
import {
  DEFAULT_SKY_QUALITY,
  SKY_QUALITY_RULES,
  type SkyQualityOptions,
} from '../../../../sdk-core/src/modules/sky/quality.ts'
import { skyLightColor, skyLightSource } from '../../../../sdk-core/src/modules/sky/skyLight.ts'
import { capturedClouds } from '../../modules/sky/skyLight/captureClouds.ts'
import type { SkyLightInputs } from '../../modules/sky/skyLight/captureInputs.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { cloudsMoved } from './encodeClouds.ts'
import { applySkyToRuntime, followSkyModule, skyStateOf } from './encodeCloudsSky.ts'
import { captureCloudsOf } from './captureCloudsState.ts'
import { encodeSkyCapture, writeSkyLightParams } from './encodeSkyLight.ts'
import { capturePreExposure } from './skyLightFog.ts'
import { skyLightStandIn } from '../../modules/sky/skyLight/standIn.ts'
import { writeAirlessFrame } from './airlessFrame.ts'
import { installGpuGlobals } from '../../../../../tests/kit/fakeDevice/globals.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { skyLightPending, skyLightReadOf, skyLightStateOf } from './skyLightState.ts'
import { runtime, SCENE, word } from './skyFollow.fixture.ts'
import { ATMOSPHERE_SLOT } from '../../../../sdk-core/src/scene/core/atmospherePack.ts'

const DEVICE = {} as GPUDevice
const nextImage = (rt: WebgpuPagesRuntime) => void rt.run.frame++

test('a quality setting written after the sky was given reaches the sky light in the next image', () => {
  const context: SkyQualityOptions = {}
  const rt = runtime(context)
  applySkyToRuntime(rt, word({ skyLight: true, clouds: false }), SCENE)
  followSkyModule(rt, DEVICE)
  const held = () => skyLightStateOf(rt).source!.part
  assert.equal(held().quality.skyLightIntensityScale, 1)
  const before = skyLightColor(held(), true)[0]
  context.skyLightIntensityScale = 0.8
  nextImage(rt)
  followSkyModule(rt, DEVICE)
  assert.equal(held().quality.skyLightIntensityScale, 0.8)
  assert.equal(skyLightColor(held(), true)[0] / before, 0.8)
  // Nothing moved: the part is the same object, not made again each image.
  const kept = held()
  nextImage(rt)
  followSkyModule(rt, DEVICE)
  assert.equal(held(), kept)
})

test('a new word is followed under the settings already live', () => {
  const rt = runtime({ skyLightShadowFromOpaque: true })
  applySkyToRuntime(rt, word({ skyLight: true, clouds: false }), SCENE)
  followSkyModule(rt, DEVICE)
  assert.equal(skyLightStateOf(rt).source!.part.quality.skyLightShadowFromOpaque, true)
  applySkyToRuntime(rt, word({ skyLight: true, clouds: false, sun: false }), SCENE)
  followSkyModule(rt, DEVICE)
  assert.equal(skyLightStateOf(rt).source!.part.quality.skyLightShadowFromOpaque, true)
})

test('the clouds are out of the followed sky while `cloudsOn` is off', () => {
  const context: SkyQualityOptions = { cloudsOn: false }
  const rt = runtime(context)
  applySkyToRuntime(rt, word({ skyLight: true, clouds: true }), SCENE)
  followSkyModule(rt, DEVICE)
  assert.equal(skyStateOf(rt)!.sky!.clouds, undefined, 'no clouds part, no material made')
  assert.ok(skyLightStateOf(rt).source, 'the sky light stays')
  assert.equal(skyStateOf(rt)!.material, undefined)
})

/** What a capture is told, over a sky followed under `options`. */
function captureInput(options: SkyQualityOptions, airPresent: boolean) {
  const followed = skyAtQuality(
    word({ skyLight: true, clouds: true }),
    resolveSettings(SKY_QUALITY_RULES, options),
  )
  return {
    part: followed.skyLight!,
    air: { maps: {} },
    fog: {},
    clouds: { part: followed.clouds!, air: { airPresent, sunShadowChannel: 0 } },
  } as unknown as SkyLightInputs
}
const captured = (options: SkyQualityOptions, airPresent: boolean) =>
  capturedClouds(captureInput(options, airPresent))!.key

test('the capture’s clouds read the sun’s shadow in the opaque scene only where the setting asks, and the harmonics only with no air', () => {
  assert.deepEqual(
    [
      captured({}, true).opaqueShadow,
      captured({ skyLightShadowFromOpaque: true }, true).opaqueShadow,
    ],
    [false, true],
  )
  assert.deepEqual([captured({}, true).skyLight, captured({}, false).skyLight], [false, true])
})

test('the stand-in air’s frame is written once an image, whoever asks first, and again in the next', () => {
  installGpuGlobals()
  const writes: unknown[] = []
  const device = {
    createTexture: () => ({ createView: () => ({}) }),
    createSampler: () => ({}),
    createBuffer: () => ({}),
    queue: { writeBuffer: (...args: unknown[]) => writes.push(args), writeTexture() {} },
  } as unknown as GPUDevice
  const rt = { run: { frame: 5 }, gpu: { targetSize: [64, 32] } } as unknown as WebgpuPagesRuntime
  const cam = { eye: [0, 100, 0], world: new Float64Array(16), perspective: 1 } as never
  const first = writeAirlessFrame(rt, device, cam, 6360)
  assert.equal(writeAirlessFrame(rt, device, cam, 6360), first, 'the same air')
  assert.equal(writes.length, 1, 'the shadow maps and the trace share the image’s frame')
  nextImage(rt)
  writeAirlessFrame(rt, device, cam, 6360)
  assert.equal(writes.length, 2)
})

test('the readers of one frame’s capture share its clouds and their one key, a new frame asking again', () => {
  const input = captureInput({}, true)
  const traced = capturedClouds(input)
  assert.ok(traced)
  assert.equal(capturedClouds(input), traced, 'the wait for the program, the groups and the faces')
  assert.notEqual(capturedClouds(captureInput({}, true)), traced, 'the next frame’s input')
})

test('the lights of the air are packed for a scene with no atmosphere only while a clouds part is followed', () => {
  installGpuGlobals()
  const { device } = fakeDevice()
  const rt = runtime({})
  const { store } = rt.lights
  store.add({
    id: 'sun',
    kind: 'directional',
    direction: [0, -1, 0],
    color: [1, 1, 1],
    intensity: 4,
    castsShadow: false,
  })
  const lit = () => store.atmospherePacked[ATMOSPHERE_SLOT.sunIlluminance * 4]
  applySkyToRuntime(rt, word({ skyLight: true, clouds: true }), SCENE)
  assert.equal(lit(), 0, 'nothing asked yet')
  followSkyModule(rt, device)
  assert.equal(lit(), 4, 'the clouds light a medium by it')
  applySkyToRuntime(rt, word({ skyLight: true, clouds: false }), SCENE)
  nextImage(rt)
  followSkyModule(rt, device)
  assert.equal(lit(), 0, 'a sky with no clouds part asks for none')
  applySkyToRuntime(rt, word({ skyLight: true, clouds: true }), SCENE)
  followSkyModule(rt, device)
  assert.equal(lit(), 4)
  applySkyToRuntime(rt, undefined, SCENE)
  assert.equal(lit(), 0, 'the module off, none')
})

test('the sky light’s capture is asked by the main view alone, once a frame', () => {
  const rt = runtime({})
  const main = { overrides: {} },
    aside = { overrides: {} }
  // The capture reads the device it is made over: counted, it tells where the capture was asked.
  let asked = 0
  Object.defineProperty(rt.gpu, 'device', {
    get: () => (asked++, undefined),
  })
  Object.assign(rt, { views: { main, active: main }, capture: { capturing: false } })
  applySkyToRuntime(rt, word({ skyLight: true, clouds: false }), SCENE)
  followSkyModule(rt, DEVICE)
  const encoder = {} as GPUCommandEncoder
  asked = 0
  encodeSkyCapture(rt, DEVICE, encoder)
  assert.ok(asked > 0, 'the main view asks for the capture')
  asked = 0
  rt.views.active = aside as never
  encodeSkyCapture(rt, DEVICE, encoder)
  assert.equal(asked, 0, 'a view drawn beside the main one does not')
  rt.views.active = main as never
  Object.assign(rt.capture, { capturing: true })
  encodeSkyCapture(rt, DEVICE, encoder)
  assert.equal(asked, 0, 'nor the capture of an image aside')
})

/** A runtime whose sky light has a cube ready (a capture that reads one), over a device that records the
 *  light's read uniform it is given; no capture is encoded (the runtime holds no device until `ready`). */
function readyLight() {
  installGpuGlobals()
  const rt = runtime({})
  const main = { overrides: { skyLighting: true } }
  Object.assign(rt, { views: { main, active: main }, capture: { capturing: false } })
  applySkyToRuntime(rt, word({ skyLight: true, clouds: false }), SCENE)
  followSkyModule(rt, DEVICE)
  const ready = { cube: {}, harmonics: {}, mips: 3, colorScale: 1, layer: 0, blend: 0 }
  const state = skyLightStateOf(rt)
  // A light that captures in real time, whatever the defaults, with a capture that reads a cube.
  const { part } = state.source!
  state.source = {
    ...state.source!,
    part: {
      ...part,
      light: { ...part.light, realTimeCapture: true, mobility: 'movable' },
      quality: { ...part.quality, skyLightRealTimeCapture: true },
    },
  }
  assert.equal(skyLightSource(state.source.part), 'realTime')
  const capture = { read: () => ready } as never
  state.capture = capture
  // The words of each `writeBuffer`, read from the bytes the queue is given.
  const writes: Float32Array[] = []
  const recording = {
    createBuffer: () => ({}),
    queue: {
      writeBuffer: (_b: unknown, _o: number, data: ArrayBuffer, at: number, bytes: number) =>
        writes.push(new Float32Array(data.slice(at, at + bytes))),
    },
  } as unknown as GPUDevice
  return { rt, main, state, capture, writes, device: recording }
}

test('the first image whose cube is ready is read as the sky, not the stand-in, by the cards and the bounce that follow the capture', () => {
  const { rt, state, capture } = readyLight()
  const { device } = fakeDevice()
  state.capture = undefined
  assert.equal(skyLightPending(rt), true, 'a real-time light with no cube waits')
  state.capture = capture
  assert.equal(state.params, undefined, 'no uniform before the capture’s step')
  encodeSkyCapture(rt, device, {} as GPUCommandEncoder)
  Object.assign(rt.gpu, { device })
  assert.ok(state.params, 'the uniform exists once the capture’s step is done')
  const read = skyLightReadOf(rt)
  assert.equal(read.params, state.params)
  assert.notEqual(read.params, skyLightStandIn(device).params, 'the cards do not read the stand-in')
  assert.equal(
    skyLightPending(rt),
    false,
    'the bounce does not wait: its probes trace this image’s sky',
  )
})

test('the light’s read uniform follows the view’s sky lighting override: a view beside the main one is written dark, the main one lit', () => {
  const { rt, main, state, writes, device } = readyLight()
  const aside = { overrides: { skyLighting: false } }
  const lit = skyLightColor(state.source!.part, true, 1, capturePreExposure(rt))
  assert.ok(lit[0] > 0)
  encodeSkyCapture(rt, device, {} as GPUCommandEncoder)
  rt.views.active = aside as never
  writeSkyLightParams(rt, device)
  rt.views.active = main as never
  writeSkyLightParams(rt, device)
  const colours = writes.map((words) => words[0])
  assert.deepEqual(colours, [Math.fround(lit[0]), 0, Math.fround(lit[0])])
})

test('the clouds drift by the world’s clock: a paused world with wind reaches a held frame, a running one is drawn on', () => {
  const rt = runtime({})
  applySkyToRuntime(rt, word({ clouds: true }), SCENE)
  skyStateOf(rt)!.sky = skyAtQuality(word({ clouds: true }), DEFAULT_SKY_QUALITY)
  // The last image drawn at the world's time 5, long since settled.
  Object.assign(rt.gpu, { clouds: { last: { drawn: true, images: 99, time: 5 } } })
  const clock = rt.run.graphClocks as { time: number }
  clock.time = 5
  assert.equal(cloudsMoved(rt), false, 'the world is paused: the wind drifts nothing')
  clock.time = 5.5
  assert.equal(cloudsMoved(rt), true, 'the clock moved: the clouds drifted')
  // A cut leaves the rebuilding unfinished whatever the clock.
  clock.time = 5
  rt.gpu.clouds!.last.images = 3
  assert.equal(cloudsMoved(rt), true)
})

test('the capture’s clouds read the maps of the image where the capture asks, and hold none of their own', () => {
  installGpuGlobals()
  const { device } = fakeDevice()
  const rt = runtime({})
  const noise = {} as GPUTextureView
  Object.assign(rt.gpu, { device, deferred: { placeholders: { vsmBlueNoise: noise } } })
  const part = skyAtQuality(word({ clouds: true }), DEFAULT_SKY_QUALITY).clouds!
  const capture = captureCloudsOf(rt, part, [])
  // No map built: the stand-in that shades nothing, the same set each time it is read.
  const none = capture.cloudShadow
  assert.equal(none, capture.cloudShadow)
  assert.equal(none.frames, undefined, 'a set of no map')
  assert.equal(capture.blueNoise, noise)
  // The property is read, not stored: nothing to fill after the maps are built, nothing stale.
  assert.equal(typeof Object.getOwnPropertyDescriptor(capture, 'cloudShadow')!.get, 'function')
})
