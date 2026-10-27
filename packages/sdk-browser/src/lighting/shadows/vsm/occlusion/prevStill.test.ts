// A placement that kept its linear part has its current half axes for the box the previous image
// drew (`vsmRenderPrevStill`, `renderCandidatesWgsl.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../../../materials/texture/shaderRun.fixture.ts'
import { Mat3 } from '../../../../materials/texture/shaderRunMatrix.fixture.ts'
import { vsmRenderCandidatesWgsl } from '../render/renderCandidatesWgsl.ts'

// A placement whose linear part is the one the previous image drew it with moved at most by a
// translation: the box it drew has the half axes the box has now, which the candidate (STILL) and the
// descent reuse, whatever the translation.
test('a placement that kept its linear part has its current half axes for the previous box', () => {
  const linear = (scale: number, shear = 0) =>
    new Mat3([
      [scale, 0, 0],
      [shear, scale, 0],
      [0, 0, scale],
    ])
  const still = (now: Mat3, before: Mat3) =>
    shaderRun<{ vsmRenderPrevStill(w: number): boolean }>(
      vsmRenderCandidatesWgsl(),
      ['vsmRenderPrevStill'],
      { worldsLinear: () => now, previousLinear: () => before },
    ).vsmRenderPrevStill(0)
  assert.equal(still(linear(2), linear(2)), true, 'the same linear part')
  assert.equal(still(linear(2), linear(3)), false, 'scaled')
  assert.equal(still(linear(2), linear(2, 0.5)), false, 'sheared')
})
