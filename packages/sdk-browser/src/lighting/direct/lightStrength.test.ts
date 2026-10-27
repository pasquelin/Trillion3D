// A light's strength as the view reads it (`lightStrength`, `lightStrengthWgsl.ts`): the intensity the buffer holds, times the factor of
// its blend with the inverse of the exposure the pass draws at (`exp(-blend * ln exposure)`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { lightStrengthWgsl } from './lightStrengthWgsl.ts'

const STRENGTH = wgslModule(lightStrengthWgsl('viewExposure'))
const at = (exposure: number, blend: number) =>
  shaderRun<{ lightStrength: (light: object) => number }>(STRENGTH, ['lightStrength'], {
    viewExposure: exposure,
    logExposureHeld: false,
    logExposureKept: 0,
  }).lightStrength({ colorIntensity: [1, 1, 1, 8], traits: [blend, 0, 0, 0] })

test('a light with no blend keeps its strength; a whole blend divides it by the exposure, a half one by its root', () => {
  assert.equal(at(4, 0), 8)
  assert.equal(at(1e-3, 0), 8, 'whatever the exposure')
  const near = (got: number, want: number) =>
    assert.ok(Math.abs(got - want) < 1e-5, `${got} against ${want}`)
  near(at(4, 1), 2)
  near(at(4, 0.5), 4)
  near(at(16, 1), 0.5)
  near(at(0.25, 1), 32)
})

test('no exposure known (0 or less): the strength is kept whatever the blend', () => {
  assert.equal(at(0, 1), 8)
  assert.equal(at(-1, 0.5), 8)
})

test('the lights that follow the exposure share the one logarithm taken once an invocation', () => {
  const run = shaderRun<{ lightStrength: (light: object) => number }>(STRENGTH, ['lightStrength'], {
    viewExposure: 4,
    logExposureHeld: false,
    logExposureKept: 0,
  })
  const light = (blend: number) => ({ colorIntensity: [1, 1, 1, 8], traits: [blend, 0, 0, 0] })
  const [whole, half] = [run.lightStrength(light(1)), run.lightStrength(light(0.5))]
  assert.ok(Math.abs(whole - 2) < 1e-5 && Math.abs(half - 4) < 1e-5)
  assert.equal(run.lightStrength(light(1)), whole, 'again, from the held logarithm')
})
