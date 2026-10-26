// The automatic exposure's update, its programs run in JavaScript over the uniform the CPU writes:
// it adapts on the world's seconds, jumps to its target at a first image and a cut, reads its EV100s
// from the saturation luminance the lens sets, and pulls the local exposure toward a grey its
// compensation curve moves.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  EXPOSURE_MIDDLE_GREY,
  exposureSaturationLuminance,
  type ExposureValues,
} from '../../../../sdk-core/src/contracts/exposureOptions.ts'
import { exposureCurveTable } from '../../../../sdk-core/src/contracts/exposureCurveTable.ts'
import {
  AT,
  bucketLuminance,
  histogramIn,
  settingsOf,
  startingExposure,
  stops,
  uniformOf,
  update,
  within,
  writerOver,
} from './meter.fixture.ts'

test('the update moves by the seconds its uniform holds: still at none, by the step of the rest', () => {
  const settings = settingsOf()
  const { write, image, uniformAt } = writerOver(settings)
  const exposure = startingExposure()
  const dark = histogramIn(30),
    bright = histogramIn(36)
  const seen: number[] = []
  const seconds: number[] = []
  // Images at the clock's seconds 10, 10.016, 10.016 (a clock that held still), 10.032 — whatever
  // the page's clock did between them: the writer reads none of its own (`exposureFrame.test.ts`
  // drives the clock itself).
  for (const [k, clock] of [10, 10.016, 10.016, 10.032].entries()) {
    write(image(clock))
    const uniform = uniformAt(k)
    seconds.push(uniform.words[AT.speeds + 3])
    update(uniform, k === 0 ? dark : bright, exposure)
    seen.push(exposure[0][0])
  }
  assert.deepEqual(seconds, [0, 0.016, 0, 0.016].map(Math.fround))
  // The first image jumps to what it asks: two to the bias, middle grey over the mean.
  within(
    seen[0],
    (2 * EXPOSURE_MIDDLE_GREY) / bucketLuminance(settings, 30),
    1e-5,
    'the first image',
  )
  // The scene brightened by 2.86 stops, past the transition distance: the exposure falls at the
  // rise's speed, 3 stops a second, over the seconds it holds only.
  within(stops(seen[0], seen[1]), 3 * 0.016, 1e-4, 'a step')
  within(stops(seen[1], seen[2]), 0, 1e-9, 'no seconds')
  within(stops(seen[2], seen[3]), 3 * 0.016, 1e-4, 'the next step')
})

test('the exposure jumps to its target at a first image, a cut and a range that is none, and at no other', () => {
  const settings = settingsOf()
  const { write, image, uniformAt } = writerOver(settings)
  const exposure = startingExposure()
  const target = (bucket: number) => (2 * EXPOSURE_MIDDLE_GREY) / bucketLuminance(settings, bucket)
  const next = (k: number, histogram: number[]) => {
    update(uniformAt(k), histogram, exposure)
    return exposure[0][0]
  }
  write(image(0, 7))
  within(next(0, histogramIn(30)), target(30), 1e-5, 'a first image')
  assert.equal(uniformAt(0).words[AT.response + 3], 1)
  // The same cut, the scene far brighter: it moves a step, it does not jump.
  write(image(0.016, 7))
  assert.equal(uniformAt(1).words[AT.response + 3], 0)
  const moved = next(1, histogramIn(44))
  assert.ok(moved < target(30) && moved > target(44) * 4, 'a step')
  // A view cut: the target at once.
  write(image(0.032, 8))
  assert.equal(uniformAt(2).words[AT.response + 3], 1)
  within(next(2, histogramIn(44)), target(44), 1e-5, 'a cut')
  // Where the range holds one brightness the exposure is its own and the image changes nothing.
  const fixed = settingsOf({ exposureMinBrightness: 5, exposureMaxBrightness: 5 })
  write(image(0.048, 8, fixed))
  assert.equal(uniformAt(3).words[AT.response + 3], 1)
  const first = next(3, histogramIn(10))
  write(image(0.064, 8, fixed))
  within(next(4, histogramIn(55)), first, 1e-9, 'a range of none')
  within(first, 2 / 2 ** 5, 1e-6, 'two to the bias over the white point')
})

test('the EV100s are read from the saturation luminance the lens sets: the range, the histogram, the curve', () => {
  const lens = settingsOf({ exposureLensAttenuation: 0.39 })
  const saturation = exposureSaturationLuminance(lens.exposureLensAttenuation)
  within(saturation, 2, 1e-12)
  const plain = uniformOf(settingsOf()),
    lensed = uniformOf(lens)
  within(lensed.words[AT.bounds], 2 * plain.words[AT.bounds], 1e-6, 'the lowest mean')
  within(lensed.words[AT.bounds + 1], 2 * plain.words[AT.bounds + 1], 1e-6, 'the highest mean')
  // The histogram spans the same stops, moved up by the saturation's logarithm: the bias shifts.
  within(lensed.words[AT.histogram], plain.words[AT.histogram], 1e-9, 'the scale')
  within(lensed.words[AT.histogram + 1], (9 / 30) * 1, 1e-6, 'the bias')
  within(plain.words[AT.histogram + 1], 10 / 30, 1e-6, 'the default bias')
  assert.equal(lensed.words[AT.image + 1], 2)
  assert.equal(plain.words[AT.image + 1], 1, 'a saturation luminance of 1 at the default')
  // A curve lifting the exposure by one stop for every ten of EV100 from 0 to 10, read at the EV100
  // the saturation puts the scene at: its mean over the middle grey over the saturation.
  const table = exposureCurveTable([
    [0, 0],
    [10, 1],
  ])
  const bucket = 20
  const mean = bucketLuminance(lens, bucket)
  const run = (settings: ExposureValues, histogram: number[]) =>
    update(uniformOf(settings, { jumps: true }), histogram, startingExposure(), table)
  const ev = Math.log2(mean / EXPOSURE_MIDDLE_GREY / saturation)
  const lensedOut = run(lens, histogramIn(bucket))
  within(lensedOut[0][3], 2 * 2 ** (ev / 10), 2e-3, 'the bias, the curve’s factor in it')
  // Without the lens the same mean sits one stop higher on the curve.
  const bare = settingsOf()
  const plainMean = bucketLuminance(bare, bucket)
  const bareOut = run(bare, histogramIn(bucket))
  within(
    bareOut[0][3],
    2 * 2 ** (Math.log2(plainMean / EXPOSURE_MIDDLE_GREY) / 10),
    2e-3,
    'no lens',
  )
})

test('the local exposure’s grey leaves the meter with the curve’s factor in it', () => {
  const settings = settingsOf({
    localExposureHighlightContrast: 0.5,
    localExposureMiddleGreyBias: -1,
  })
  const table = exposureCurveTable([
    [0, 0],
    [10, 1],
  ])
  const out = update(
    uniformOf(settings, { jumps: true }),
    histogramIn(20),
    startingExposure(),
    table,
  )
  const bias = out[0][3]
  assert.ok(bias > 2 * 1.0001, 'a curve over the bias')
  within(out[1][2], Math.log2(EXPOSURE_MIDDLE_GREY * bias * 2 ** -1), 1e-6, 'the grey')
  // Without a curve it is the bias's alone: what the CPU knows of the grey.
  const flat = update(uniformOf(settings, { jumps: true }), histogramIn(20), startingExposure())
  within(flat[1][2], Math.log2(EXPOSURE_MIDDLE_GREY * 2 * 2 ** -1), 1e-6, 'no curve')
})
