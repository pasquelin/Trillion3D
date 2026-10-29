import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MOBILITY_DEFORMS,
  MOBILITY_MOVING,
  MOBILITY_OFFSET_INVALIDATES,
  MOBILITY_OFTEN_MOVING,
  MOBILITY_SHADOWLESS,
} from '../../mobilityBits.ts'
import { CASTER_LEGEND, casterClass } from './casterBounds.ts'

const [staticColor, staticInvalidating, dynamicColor, dynamicInvalidating, dynamicMaybe] =
  CASTER_LEGEND.map(([, color]) => color)

test('the class of a placement follows how the shadows keep it', () => {
  assert.deepEqual(casterClass(0), { color: staticColor, bounds: false })
  assert.deepEqual(casterClass(MOBILITY_DEFORMS), { color: staticInvalidating, bounds: true })
  assert.deepEqual(casterClass(MOBILITY_OFTEN_MOVING), { color: dynamicColor, bounds: false })
  assert.deepEqual(casterClass(MOBILITY_MOVING), { color: dynamicInvalidating, bounds: true })
  assert.deepEqual(casterClass(MOBILITY_OFTEN_MOVING | MOBILITY_DEFORMS), {
    color: dynamicInvalidating,
    bounds: true,
  })
  assert.deepEqual(casterClass(MOBILITY_OFTEN_MOVING | MOBILITY_OFFSET_INVALIDATES), {
    color: dynamicMaybe,
    bounds: true,
  })
})

test('a placement that casts no shadow is grey and shows no box', () => {
  const grey = casterClass(MOBILITY_SHADOWLESS | MOBILITY_MOVING)
  assert.equal(grey.bounds, false)
  assert.notEqual(grey.color, staticColor)
})
