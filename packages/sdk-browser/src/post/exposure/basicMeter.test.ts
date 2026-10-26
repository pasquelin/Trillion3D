// The basic method's measure: the image brought down to a quarter of its size, each texel's colour
// placed as a log luminance, four levels under it each the mean of the 4 × 4 texels around the one
// above, and the grid they end on summed lane by lane with the metering mask's weights — its shaders
// run in JavaScript, over the levels as their definition makes them.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { BASIC_SETUP_WGSL } from './basicWgsl.ts'
import { luminanceReading } from './meterParams.ts'
import { MEASURE_WGSL } from './meterWgsl.ts'
import {
  SIZE,
  gridOf,
  logGainOf,
  measureOf,
  modelOf,
  pictureOf,
  type Mask,
  type Picture,
} from './basic.fixture.ts'
import type { ExposureValues } from '../../../../sdk-core/src/contracts/exposureOptions.ts'
import {
  meterOf,
  settingsOf,
  startingExposure,
  uniformOf,
  update,
  within,
} from './meter.fixture.ts'

/** The image of a ramp that doubles every 64 pixels across, half as bright in its lower half and
 *  six times in a block of its upper right: the light the metered image holds. */
const ramp = (x: number, y: number) => {
  const light = 0.01 * 2 ** (x / 64) * (y < 128 ? 1 : 0.5) * (x > 400 && y < 64 ? 6 : 1)
  return [light, light * 0.5, light * 0.25, 1]
}

test('the setup places a texel’s colour as a log luminance over the histogram’s range, as the composition reads it', () => {
  const settings = settingsOf({ exposureMethod: 'basic' })
  const { scale, bias } = luminanceReading(settings)
  const meter = meterOf(uniformOf(settings, { size: SIZE }))
  const { scaledLog } = shaderRun<{ scaledLog: (colour: number[]) => number }>(
    BASIC_SETUP_WGSL,
    ['scaledLog'],
    { meter },
  )
  const placed = (luminance: number) => Math.log2(luminance) * scale + bias
  within(scaledLog([0.5, 0.5, 0.5, 1]), placed(0.5), 1e-6, 'a grey')
  within(
    scaledLog([0.5, 0.5, 0.5, 0.25]),
    placed(0.5),
    1e-6,
    'its colour as it is, whatever its alpha',
  )
  within(scaledLog([2 ** 30, 2 ** 30, 2 ** 30, 1]), 20 * scale + bias, 1e-6, 'held at 20 stops')
  within(scaledLog([0, 0, 0, 1]), -10 * scale + bias, 1e-6, 'a pixel of no light, at the least')
  // The weights of the colour channels, the uniform mean by default.
  within(scaledLog([0.3, 0.6, 0.9, 1]), placed(0.6), 1e-6, 'the mean of the channels')
})

/** The update over the measure's words for `grid` under `settings`, jumping to its target: the
 *  exposure buffer it leaves. */
function updated(settings: ExposureValues, grid: Picture, mask?: Mask) {
  return update(
    uniformOf(settings, { size: SIZE, jumps: true, masked: !!mask }),
    measureOf(settings, grid, mask),
    startingExposure(),
  )
}

test('the basic method’s mean is the weighted mean of the grid’s log luminance, the mask weighing it', () => {
  const settings = settingsOf({ exposureMethod: 'basic' })
  const grid = gridOf(settings, pictureOf(SIZE[0], SIZE[1], ramp))
  assert.deepEqual([grid.width, grid.height], [8, 4], 'a sixty-fourth of the image on each axis')
  const half = (u: number) => (u < 0.5 ? 0.2 : 1)
  for (const mask of [undefined, half]) {
    const out = updated(settings, grid, mask)
    within(out[0][2], 2 ** modelOf(settings, grid, mask).mean, 1e-5, 'the mean luminance')
  }
  assert.ok(
    modelOf(settings, grid, half).mean > modelOf(settings, grid).mean + 0.2,
    'the mask that keeps the bright half moves the mean',
  )
})

test('the basic method’s local gain is the mean of the gain of each lane’s plain mean, as the reference does it', () => {
  // Highlights come down by half, the shadows stay: the gain is not linear in the base layer.
  const settings = settingsOf({
    exposureMethod: 'basic',
    localExposureHighlightContrast: 0.5,
    localExposureShadowContrast: 1,
  })
  // A grid half 2 stops over its mean and half 2 under (the stops between the halves blur over the
  // columns the chain's windows share, the lanes see that too).
  const split = pictureOf(SIZE[0], SIZE[1], (x) => {
    const light = 2 ** (x < SIZE[0] / 2 ? -5 : -1)
    return [light, light, light, 1]
  })
  const grid = gridOf(settings, split)
  const out = updated(settings, grid)
  const { lanes } = modelOf(settings, grid)
  const exposure = out[0][0],
    grey = out[1][2]
  // The reference: per lane the gain at the lane's own plain mean, averaged by the lane's texels.
  let sum = 0,
    count = 0
  for (const lane of lanes) {
    sum += logGainOf(lane.mean + Math.log2(exposure), grey, 0.5, 1) * lane.count
    count += lane.count
  }
  within(out[1][1], 2 ** (sum / count), 1e-5, 'the lanes’ mean')
  // Not the gain at the grid's plain mean: that is a gain near 1 where the halves cancel.
  const plain = lanes.reduce((all, lane) => all + lane.mean * lane.count, 0) / count
  const atMean = 2 ** logGainOf(plain + Math.log2(exposure), grey, 0.5, 1)
  assert.ok(Math.abs(out[1][1] / atMean - 1) > 0.2, `${out[1][1]} against ${atMean}`)
  // Equal contrasts make it linear again: the two agree.
  const even = settingsOf({
    exposureMethod: 'basic',
    localExposureHighlightContrast: 0.5,
    localExposureShadowContrast: 0.5,
  })
  const evenOut = updated(even, gridOf(even, split))
  within(
    evenOut[1][1],
    2 ** logGainOf(plain + Math.log2(evenOut[0][0]), evenOut[1][2], 0.5, 0.5),
    1e-5,
    'equal contrasts',
  )
})

test('the grid’s texels in the darkest bucket weigh the black bucket’s share, none by default', () => {
  const black = pictureOf(SIZE[0], SIZE[1], () => [0, 0, 0, 1])
  const meanOf = (settings: ExposureValues, image: Picture) =>
    Math.log2(updated(settings, gridOf(settings, image))[0][2])
  const none = settingsOf({ exposureMethod: 'basic' })
  // Every texel is at the least stop: weighing nothing, the mean is the histogram's lowest.
  within(meanOf(none, black), -10, 1e-6, 'black cells weigh nothing')
  const counted = settingsOf({ exposureMethod: 'basic', exposureBlackBucketWeight: 1 })
  within(meanOf(counted, black), -10, 1e-6, 'black cells counted: the least stop read')
  // A grid with half its texels dark: the dark half weighs the share the setting says.
  const half = pictureOf(SIZE[0], SIZE[1], (x) => (x < 256 ? [0, 0, 0, 1] : [1, 1, 1, 1]))
  const weightHalf = settingsOf({ exposureMethod: 'basic', exposureBlackBucketWeight: 0.5 })
  const split = gridOf(weightHalf, half)
  const mean = Math.log2(updated(weightHalf, split)[0][2])
  within(mean, modelOf(weightHalf, split).mean, 1e-5, 'a share')
  assert.ok(mean < 0 && mean > -10)
})

test('the histogram reads the metering mask once for each 2 × 2 quad of half pixels, at the first, none where no mask is bound', () => {
  const read = (masked: boolean, at: number[]) => {
    const meter = meterOf(uniformOf(settingsOf(), { size: [200, 100], masked }))
    const seen: number[][] = []
    const { quadWeight } = shaderRun<{ quadWeight: (x: number, row: number) => number }>(
      MEASURE_WGSL,
      ['quadWeight'],
      {
        meter,
        meterMask: 'mask',
        meterSampler: 'sampler',
        textureSampleLevel: (_: string, __: string, uv: number[]) => (
          seen.push(uv),
          [0.25, 0, 0, 1]
        ),
      },
    )
    return { weight: quadWeight(at[0], at[1]), seen }
  }
  assert.deepEqual(read(false, [3, 5]), { weight: 1, seen: [] })
  // The half-resolution image is 100 × 50: the quad of (3, 5) starts at (2, 4), of (2, 4) as well.
  assert.deepEqual(read(true, [3, 5]), { weight: 0.25, seen: [[2 / 100, 4 / 50]] })
  assert.deepEqual(read(true, [2, 4]).seen, [[2 / 100, 4 / 50]])
  assert.deepEqual(read(true, [4, 4]).seen, [[4 / 100, 4 / 50]], 'the next quad')
})
