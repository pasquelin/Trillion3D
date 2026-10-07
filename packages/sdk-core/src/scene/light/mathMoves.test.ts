// The numbers sdk-core now writes from the maths' constants, each against the expression it was
// written as: the bits are the same, so nothing it reaches moves.
import test from 'node:test'
import assert from 'node:assert/strict'
import { DEG2RAD, SQRT3, TAU } from '../../../../math/src/constants.ts'
import { LIGHT_SETTINGS } from './contracts.ts'
import { Light } from '../../world/light/light.ts'

test('the solar disk and the spot cone are the radians they were written as', () => {
  assert.ok(Object.is(LIGHT_SETTINGS.sunAngularRadius, (0.5357 * Math.PI) / 360))
  assert.ok(Object.is(new Light('spot').angle, Math.PI / 3))
  assert.ok(Object.is(60 * DEG2RAD, Math.PI / 3))
})

test("the soft body's sphere reads 4π and √3 as it wrote them", () => {
  assert.ok(Object.is(2 * TAU, 4 * Math.PI))
  assert.ok(Object.is(2 * SQRT3, 2 * Math.sqrt(3)))
})
