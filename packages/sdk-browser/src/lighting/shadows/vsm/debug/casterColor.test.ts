import test from 'node:test'
import assert from 'node:assert/strict'
import { assertProgramAssembles } from '../../../../gpu/core/wgslNames.fixture.ts'
import { shaderRun } from '../../../../materials/texture/shaderRun.fixture.ts'
import {
  MOBILITY_DEFORMS,
  MOBILITY_MOVING,
  MOBILITY_OFFSET_INVALIDATES,
  MOBILITY_OFTEN_MOVING,
  MOBILITY_SHADOWLESS,
} from '../../mobilityBits.ts'
import { CASTER_COLOR_WGSL } from './casterColor.ts'

test('the false colour is a program a device takes, with none of the reference’s names', () => {
  assertProgramAssembles(CASTER_COLOR_WGSL, 'fsCasterColor', 'the shadow casters false colour')
  assert.doesNotMatch(CASTER_COLOR_WGSL, /unreal|epic|lumen|nanite|substrate|megalights/i)
})

test('a placement’s colour is its class’s: the legend’s colours by mobility word', () => {
  const { shadowCasterColor } = shaderRun<{ shadowCasterColor: (word: number) => number[] }>(
    CASTER_COLOR_WGSL,
    ['shadowCasterColor'],
    {},
  )
  assert.deepEqual(shadowCasterColor(0), [0, 1, 0])
  assert.deepEqual(shadowCasterColor(MOBILITY_DEFORMS), [1, 0, 0])
  assert.deepEqual(shadowCasterColor(MOBILITY_OFTEN_MOVING), [0, 1, 1])
  assert.deepEqual(shadowCasterColor(MOBILITY_MOVING), [0.5, 0, 0.5])
  assert.deepEqual(shadowCasterColor(MOBILITY_OFTEN_MOVING | MOBILITY_DEFORMS), [0.5, 0, 0.5])
  assert.deepEqual(
    shadowCasterColor(MOBILITY_OFTEN_MOVING | MOBILITY_OFFSET_INVALIDATES),
    [0, 0, 1],
  )
  assert.deepEqual(shadowCasterColor(MOBILITY_SHADOWLESS), [0.5, 0.5, 0.5])
})
