// The uniform reads no clock of its own: the image entry and the pass write it word for word from
// their images, jitter ranks and the frame's length they are handed — the flicker measure's
// period, two images, shortens with that length below 60 Hz alone (`flickerCountRate`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { IDENTITY_MATRIX4 } from '../../../../math/src/matrix/matrix4.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { beginTaaFrame } from './frame.ts'
import { createTaaFrameState } from './frameState.ts'
import { writeTaaView } from './view.ts'
import { TAA_VIEW } from './bindingsWgsl.ts'
import { flickerCountRate, flickerParallaxInverse } from './flickerRates.ts'
import { TEMPORAL_DEFAULTS } from '../../../../sdk-core/src/contracts/temporalOptions.ts'
import { createScaleControl } from '../../frame/scale/scaleControl.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'

/** The uniforms of twenty images, moving then still, their frames `intervals` ms apart, each
 *  handed the frame length `handed` (ms, `null` for none). */
function uniforms(intervals: number[], handed: number | null = null) {
  const frame = createTaaFrameState(),
    temporal = { frame },
    size = () => [64, 32],
    revisions = { scene: 0, view: 0, resources: 0 }
  const rt = {
    gpu: { temporal, temporalLevel: 'max' },
    vis: {},
    run: { diagnostic: 'beauty', frame: 0, gate: { revisions } },
    capture: { capturing: false },
    lights: {},
    context: {},
  } as unknown as WebgpuPagesRuntime
  Object.assign(rt.gpu, { targetSize: size(), allocatedSize: size(), displaySize: size() })
  const scale = createScaleControl(undefined)
  Object.assign(rt, { views: { active: { scale } } })
  const { device, writes } = fakeDevice(),
    cam = {
      viewProjection: IDENTITY_MATRIX4,
      projection: IDENTITY_MATRIX4,
      eye: [0, 0, 0],
    } as unknown as EngineCamera,
    clock = { currentTime: 1000 },
    saved = globalThis.document
  Object.assign(globalThis, { document: { timeline: clock } })
  try {
    for (let image = 0; image < 20; image++) {
      clock.currentTime += intervals[image % intervals.length]
      // Moving images move the view: the still ones begin at the ninth.
      if (image < 8) revisions.view++
      beginTaaFrame(rt, cam)
      writeTaaView(
        device,
        {} as GPUBuffer,
        frame,
        cam,
        [64, 32],
        [64, 32],
        [64, 32],
        false,
        false,
        false,
        handed,
      )
      frame.hasHistory = true
      frame.sample = (frame.sample + 1) % frame.phases
    }
  } finally {
    Object.assign(globalThis, { document: saved })
  }
  return writes.map(({ data }) => [...(data as Float32Array)])
}

test('two runs of the same images write the same uniform, however long their frames', () => {
  const steady = uniforms([1000 / 120])
  assert.deepEqual(uniforms([7, 31, 12, 95, 8.3]), steady, 'a hiccuping frame rate')
  assert.deepEqual(uniforms([1000 / 30]), steady, 'thirty images a second')
})

test('the flicker period is two images down to 60 Hz, shorter below it', () => {
  const rate = TAA_VIEW.at.preExposure + 2
  const fast = uniforms([1000 / 120], 1000 / 120).at(-1)!
  assert.deepEqual(uniforms([1000 / 60], 1000 / 60).at(-1)![rate], fast[rate], '60 Hz: two images')
  assert.ok(Math.abs(fast[rate] - (1 - 0.95 ** 2)) < 1e-6, `${fast[rate]}`)
  const slow = uniforms([1000 / 30], 1000 / 30).at(-1)!
  assert.ok(Math.abs(slow[rate] - (1 - 0.95)) < 1e-6, `30 Hz: one image, ${slow[rate]}`)
})

test('the flicker period, the cap it follows and its parallax speed are the settings', () => {
  const settings = {
    ...TEMPORAL_DEFAULTS,
    temporalFlickeringPeriod: 4,
    temporalFlickeringFrameRateCap: 30,
    temporalFlickeringMaxParallaxVelocity: 20,
  }
  // At 30 Hz the frame is the cap's: the whole period, four images; at 15 Hz, two.
  assert.ok(Math.abs(flickerCountRate(1000 / 30, 1, settings) - (1 - 0.95 ** 4)) < 1e-12)
  assert.ok(Math.abs(flickerCountRate(1000 / 15, 1, settings) - (1 - 0.95 ** 2)) < 1e-12)
  // Not following the frame rate, the period is the setting's at any frame length.
  const fixed = { ...settings, temporalFlickeringAdjustToFrameRate: false }
  assert.equal(flickerCountRate(1000 / 15, 1, fixed), flickerCountRate(null, 1, fixed))
  assert.ok(Math.abs(flickerCountRate(null, 3, fixed) - (1 - 0.95 ** 12)) < 1e-12)
  // Twenty pixels of a 1920-wide image at the cap, half as far in a 960-wide one.
  assert.equal(flickerParallaxInverse(1920, 1000 / 30, settings), 1 / 20)
  assert.equal(flickerParallaxInverse(960, 1000 / 30, settings), 1 / 10)
})
