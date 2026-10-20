import test from 'node:test'
import assert from 'node:assert/strict'
import { displayResolutionFraction, renderScaleBounds } from './renderScaleOption.ts'

/** A 720-tall display, where the default renders the display's own size. */
const HD = 1280 * 720,
  UHD = 3840 * 2160

test('a page asks the controller, its bounds, or one fixed scale, always within [0.5, 1]', () => {
  assert.deepEqual(renderScaleBounds('auto', HD), { auto: true, min: 0.5, max: 1 })
  assert.deepEqual(renderScaleBounds({ min: 0.7 }, HD), { auto: true, min: 0.7, max: 1 })
  assert.deepEqual(renderScaleBounds({ min: 0.9, max: 0.6 }, HD), {
    auto: true,
    min: 0.6,
    max: 0.6,
  })
  assert.deepEqual(renderScaleBounds({ min: 0.1, max: 2 }, HD), { auto: true, min: 0.5, max: 1 })
  assert.deepEqual(renderScaleBounds(0.67, HD), { auto: false, min: 0.67, max: 0.67 })
  assert.deepEqual(renderScaleBounds(0.1, HD), { auto: false, min: 0.5, max: 0.5 })
  for (const absent of [undefined, Number.NaN])
    assert.deepEqual(renderScaleBounds(absent, HD), { auto: false, min: 1, max: 1 }, `${absent}`)
  assert.deepEqual(renderScaleBounds(1.5, UHD), { auto: false, min: 1, max: 1 })
  // Absent, the display's default, which also caps the controller.
  assert.equal(displayResolutionFraction(HD), 1)
  assert.equal(displayResolutionFraction(640 * 360), 1)
  assert.equal(displayResolutionFraction(UHD), 0.5)
  assert.ok(Math.abs(displayResolutionFraction(1920 * 1080) - Math.sqrt(1101600 / 2073600)) < 1e-9)
  assert.ok(Math.abs(displayResolutionFraction(7680 * 4320) - 1 / 3) < 1e-9)
  assert.deepEqual(renderScaleBounds(undefined, UHD), { auto: false, min: 0.5, max: 0.5 })
  assert.deepEqual(renderScaleBounds('auto', UHD), { auto: true, min: 0.5, max: 0.5 })
  assert.deepEqual(renderScaleBounds(1, UHD), { auto: false, min: 1, max: 1 }, 'native forced')
})
