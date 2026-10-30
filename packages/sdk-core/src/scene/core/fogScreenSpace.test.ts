import test from 'node:test'
import assert from 'node:assert/strict'
import { EngineError } from '../../contracts/cache.ts'
import { sameSceneFog, validateSceneFog } from './fog.ts'
import { resolveFogScreenSpaceScattering } from './fogScreenSpace.ts'

test('the screen-space scattering is off unless asked, and holds its numbers to their ranges', () => {
  assert.equal(resolveFogScreenSpaceScattering(undefined), undefined)
  assert.equal(resolveFogScreenSpaceScattering(false), undefined)
  assert.deepEqual(resolveFogScreenSpaceScattering({ spreadScale: 0.3, blurControl: 4 }), {
    sceneColorScatteringAmountScale: 1,
    sceneColorScatteringAmountPower: 1,
    spreadScale: 0.3,
    blurControl: 1,
  })
})

test('a fog declares its screen-space scattering as a switch or an object, refused out of range', () => {
  assert.deepEqual(validateSceneFog({ screenSpaceScattering: true }), {
    screenSpaceScattering: true,
  })
  assert.deepEqual(validateSceneFog({ screenSpaceScattering: { spreadScale: 0.5 } }), {
    screenSpaceScattering: { spreadScale: 0.5 },
  })
  assert.throws(
    () => validateSceneFog({ screenSpaceScattering: { blurControl: 2 } }),
    (e: unknown) => e instanceof EngineError && /screenSpaceScattering.blurControl/.test(e.message),
  )
  assert.throws(() => validateSceneFog({ screenSpaceScattering: 3 as never }), EngineError)
})

test('two fogs that differ in their scattering do not read the same', () => {
  assert.equal(sameSceneFog({ screenSpaceScattering: true }, {}), false)
  assert.equal(
    sameSceneFog({ screenSpaceScattering: true }, { screenSpaceScattering: { spreadScale: 0.1 } }),
    true,
  )
  assert.equal(
    sameSceneFog({ screenSpaceScattering: { blurControl: 0.2 } }, { screenSpaceScattering: true }),
    false,
  )
})
