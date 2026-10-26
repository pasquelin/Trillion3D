// The numbers sdk-core now writes from the maths' constants, each against the expression it was
// written as: the bits are the same, so nothing it reaches moves.
import test from 'node:test'
import assert from 'node:assert/strict'
import { DEG2RAD } from '../../../../math/src/constants.ts'
import { LIGHT_SETTINGS } from './contracts.ts'
import { DEFAULT_OUTER_CONE_ANGLE } from './fields.ts'
import { Light } from '../../world/light/light.ts'

test('the solar disk and the spot cone are the radians they were written as', () => {
  assert.ok(Object.is(LIGHT_SETTINGS.sunAngularRadius, (0.5357 * Math.PI) / 360))
  assert.ok(Object.is(new Light('spot').outerConeAngle, 44 * DEG2RAD))
  assert.ok(Object.is(DEFAULT_OUTER_CONE_ANGLE, 44 * DEG2RAD))
  assert.ok(Object.is(60 * DEG2RAD, Math.PI / 3))
})
