import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { CATMULL_ROM_TAPS_WGSL, historySampleLaws, historySamples } from './historyWgsl.ts'
import { TEMPORAL_DEFAULTS } from '../../../../sdk-core/src/contracts/temporalOptions.ts'
import { IDENTITY_MATRIX4 } from '../../../../math/src/matrix/matrix4.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { createTaaFrameState } from './frameState.ts'
import { writeTaaView } from './view.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import { BLEND_SHADER } from '../../gpu/core/shaderTexts.fixture.ts'
import { blendTargets } from '../../blend/blendTargets.ts'
import { particleTargets } from '../../particles/particleTargets.ts'
import { TAA_VIEW } from './bindingsWgsl.ts'

const T = TAA_VIEW.at

type Taps = { uv: number[][]; weight: number[] }
const { catmullRomTaps } = shaderRun<{
  catmullRomTaps: (uv: number[], size: number[], inv: number[]) => Taps
}>(CATMULL_ROM_TAPS_WGSL, ['catmullRomTaps'], {})
const SIZE = [16, 8]
const INV = SIZE.map((s) => 1 / s)

test('the five-tap Catmull-Rom weighs one in all, and a texel centre is read as itself', () => {
  for (const uv of [
    [0.3, 0.7],
    [5.2 / 16, 3.9 / 8],
    [0.01, 0.99],
  ]) {
    const { weight } = catmullRomTaps(uv, SIZE, INV)
    assert.ok(Math.abs(weight.reduce((a, b) => a + b, 0) - 1) < 1e-6, `${uv}`)
  }
  const centre = [5.5 / 16, 2.5 / 8]
  const { uv, weight } = catmullRomTaps(centre, SIZE, INV)
  assert.deepEqual(weight, [0, 0, 1, 0, 0])
  assert.ok(
    uv[2].every((v, i) => Math.abs(v - centre[i]) < 1e-9),
    `${uv[2]}`,
  )
})

// The as-is pixels of a debug view are composed after the temporal pass from the surfaces, which
// no translucency writes: a blend writes no as-is share (it wrote 0 over a seeded share at its
// coverage, in a target after the request's).
test('a blend writes no as-is share, a particle neither', () => {
  // A blend's outputs: its colour, the request and the display layers.
  assert.match(
    BLEND_SHADER,
    /struct BlendOut\{@location\(0\) color:vec4f,@location\(1\) request:u32,@location\(2\) tint:vec4f,@location\(3\) add:vec4f,\}/,
  )
  // Its targets: the translucency target, the request's slot (empty without feedback), the display
  // layers' (empty unfiltered); the responsiveness is the pass of its own's.
  const targets = blendTargets('normal', 0xf, false)
  assert.equal(targets.length, 4)
  assert.deepEqual(targets.slice(1, 4), [null, null, null])
  // A particle's targets are the translucency target and the display layers alone.
  for (const routed of [false, true])
    for (const blend of ['additive', 'premultiplied'] as const)
      assert.equal(particleTargets(blend, routed).length, routed ? 3 : 1)
})

test('the uniform carries the parallax, the flicker rates, the blend factor and the depth terms', () => {
  const { device, writes } = fakeDevice(),
    state = createTaaFrameState()
  // Last image: the identity view at the eye (1, 2, 3); this one: the eye moved by (0.5, 0, 0).
  state.before = {
    viewProjection: new Float64Array(IDENTITY_MATRIX4),
    eye: new Float64Array([1, 2, 3]),
    image: 1,
  }
  state.stochasticSample = 13
  const projection = new Float64Array(16)
  projection[0] = 2
  projection[11] = -1
  projection[14] = 0.1
  const cam = {
    viewProjection: IDENTITY_MATRIX4,
    eye: [1.5, 2, 3],
    projection,
  } as unknown as EngineCamera
  writeTaaView(device, {} as GPUBuffer, state, cam, [960, 540], [1920, 1080], [960, 540], false)
  const u = writes.at(-1)!.data as Float32Array
  // `previous · (lastEye − eye, 0)`: the identity's image of (−0.5, 0, 0, 0).
  assert.deepEqual([...u.subarray(T.parallax, T.parallax + 4)], [-0.5, 0, 0, 0])
  assert.ok(
    Math.abs(u[T.preExposure + 2] - (1 - 0.95 ** 2)) < 1e-7,
    'two images a period: 1 − 0.95²',
  )
  assert.ok(Math.abs(u[T.preExposure + 3] - (1 - 0.95 ** 6)) < 1e-7, 'thin geometry: three periods')
  assert.ok(Math.abs(u[T.rates] - 1 / 5) < 1e-7, 'ten 1080p pixels at 60 Hz: five of 960')
  assert.ok(Math.abs(u[T.rates + 1] - 1 / (1 + 16 / 0.25)) < 1e-7, 'half the display: 1 / 65')
  assert.equal(u[T.rates + 2], 0, 'the shading rejection is in its stability mode by default')
  assert.deepEqual(
    [...u.subarray(T.depth, T.depth + 4)].map((v) => Math.fround(v)),
    [0, Math.fround(0.1), -1, 0],
  )
  assert.ok(Math.abs(u[T.radius] - 1 / (2 * 960)) < 1e-9, 'a render pixel radius per unit depth')
  assert.equal(u[T.radius + 2], -1, 'the view looks down its negative axis')
  assert.equal(u[T.params], 1, 'no history yet: a cut')
  assert.equal(u[T.jitter + 3], 13 % 8, 'the image rank among eight')
  // The settings' defaults: the thin geometry detection's depth step ten errors, its contrast and
  // weights, and the shading exposure offset one.
  assert.deepEqual(
    [...u.subarray(T.thin, T.thin + 4)].map((v) => Math.fround(v)),
    [10, 0.3, 0.6, 0.6].map((v) => Math.fround(v)),
  )
  assert.deepEqual(
    [...u.subarray(T.thinFade, T.thinFade + 3)].map((v) => Math.fround(v)),
    [0.1, 0.03, 0.037].map((v) => Math.fround(v)),
  )
  assert.equal(u[T.preExposure + 1], 1)
})

test('the uniform carries the settings of the thin geometry detection, the flicker measure and the exposure offset', () => {
  const { device, writes } = fakeDevice(),
    state = createTaaFrameState()
  state.before = {
    viewProjection: new Float64Array(IDENTITY_MATRIX4),
    eye: new Float64Array([0, 0, 0]),
    image: 1,
  }
  const projection = new Float64Array(16)
  projection[0] = 2
  projection[11] = -1
  const cam = {
    viewProjection: IDENTITY_MATRIX4,
    eye: [0, 0, 0],
    projection,
  } as unknown as EngineCamera
  const settings = {
    ...TEMPORAL_DEFAULTS,
    temporalThinGeometryErrorMultiplier: 100,
    temporalThinGeometryMinKeepLineContrast: 0.5,
    temporalThinGeometryLineFadeRate: 0.2,
    temporalThinGeometryLineFadeRateInsideRegion: 0.05,
    temporalThinGeometryLineWeight: 0.4,
    temporalThinGeometryMaxRelaxationWeight: 0.5,
    temporalThinGeometryRejectTranslucency: 0.7,
    temporalShadingExposureOffset: 2,
    temporalFlickeringPeriod: 0,
    temporalHistorySampleCount: 8,
  }
  const history = {
    width: 1920,
    height: 1080,
    scale: 1,
    field: false,
    fieldSpeed: 0.125,
    resurrects: false,
    settings,
  }
  writeTaaView(
    device,
    {} as GPUBuffer,
    state,
    cam,
    [1920, 1080],
    [1920, 1080],
    [1920, 1080],
    false,
    false,
    false,
    null,
    0,
    undefined,
    undefined,
    1,
    history,
  )
  const u = writes.at(-1)!.data as Float32Array
  assert.deepEqual(
    [...u.subarray(T.thin, T.thin + 4)],
    [5, 0.5, Math.fround(0.4), Math.fround(0.7)],
    'a twentieth of the multiplier, 5 errors',
  )
  assert.deepEqual(
    [...u.subarray(T.thinFade, T.thinFade + 3)],
    [Math.fround(0.2), Math.fround(0.05), 0.5],
  )
  assert.equal(u[T.preExposure + 1], 4, 'two stops')
  assert.equal(u[T.preExposure + 2], 0, 'a period of 0 fades in nothing')
  assert.equal(u[T.quality], 0, 'and runs no flicker rejection')
  assert.equal(u[T.history], 8, 'the history holds eight samples a pixel')
  assert.ok(Math.abs(u[T.rates + 1] - 1 / (1 + 8)) < 1e-7, 'the blend factor of a whole history')
})

test('the uniform carries the shading rejection mode and the thin geometry anti-flickering in the rates', () => {
  const identity = { viewProjection: IDENTITY_MATRIX4, eye: [0, 0, 0] }
  const ratesOf = (overrides: Partial<typeof TEMPORAL_DEFAULTS>) => {
    const { device, writes } = fakeDevice(),
      state = createTaaFrameState()
    const projection = new Float64Array(16)
    projection[0] = 2
    projection[11] = -1
    writeTaaView(
      device,
      {} as GPUBuffer,
      state,
      { ...identity, projection } as unknown as EngineCamera,
      [1920, 1080],
      [1920, 1080],
      [1920, 1080],
      false,
      false,
      false,
      null,
      0,
      undefined,
      undefined,
      1,
      {
        width: 1920,
        height: 1080,
        scale: 1,
        field: false,
        fieldSpeed: 0.125,
        resurrects: false,
        settings: { ...TEMPORAL_DEFAULTS, ...overrides },
      },
    )
    const u = writes.at(-1)!.data as Float32Array
    return [u[T.rates + 2], u[T.rates + 3]]
  }
  // Stability is the default and writes 0; responsive writes 1. Anti-flickering is on by default.
  assert.deepEqual(ratesOf({}), [0, 1])
  assert.deepEqual(ratesOf({ temporalShadingRejectionMode: 'responsive' }), [1, 1])
  assert.deepEqual(ratesOf({ temporalThinGeometryAntiFlickering: false }), [0, 0])
})

test('the display history holds 16 samples a pixel: an image weighs one, a rejection keeps two, motion four', () => {
  assert.deepEqual(historySampleLaws(1), {
    samples: 16,
    hysteresis: 1 / 16,
    rejectedDrop: 1 - 2 / 16,
    movingDrop: 1 - 4 / 16,
    speedInverse: 1,
  })
})

test('a history of twice the display holds a quarter of the samples a pixel, and a moving one is not clamped', () => {
  // Four samples a history pixel, still sixteen a display pixel; a rejection keeps two of a display
  // pixel, half a history pixel's; motion four samples of a history pixel, all it holds; the speed read
  // in display pixels over a history pixel is half.
  assert.deepEqual(historySampleLaws(2), {
    samples: 4,
    hysteresis: 1 / 4,
    rejectedDrop: 1 - (2 / 4) * (1 / 4),
    movingDrop: 0,
    speedInverse: 1 / 2,
  })
})

test('the history keeps the samples its settings name: the most, after a rejection, and in motion', () => {
  const laws = historySampleLaws(1, {
    ...TEMPORAL_DEFAULTS,
    temporalHistorySampleCount: 32,
    temporalShadingRejectionSampleCount: 4,
    temporalVelocityWeightClampingSampleCount: 8,
    temporalVelocityWeightClampingPixelSpeed: 2,
  })
  assert.deepEqual(laws, {
    samples: 32,
    hysteresis: 1 / 32,
    rejectedDrop: 1 - 4 / 32,
    movingDrop: 1 - 8 / 32,
    speedInverse: 1 / 2,
  })
  assert.equal(historySamples(2, 32), 8, 'a history of twice the display holds a quarter a pixel')
})
