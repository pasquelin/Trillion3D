// The live shading's march: the functions it declares, and the reference's constants it keeps.
import test from 'node:test'
import assert from 'node:assert/strict'
import { HV_RAY_MARCH_WGSL } from './liveShadingWgsl.ts'

const text = HV_RAY_MARCH_WGSL.text

test('the march declares the reference functions, in the reference order of the steps', () => {
  for (const name of [
    'hvIntersectAabb',
    'hvStepSize',
    'hvRecalculateStepSize',
    'hvStepCount',
    'hvComputeTransmittance',
    'hvShadowBias',
    'hvShadowedInscattering',
    'hvRayMarch',
  ])
    assert.match(text, new RegExp(`fn ${name}\\(`), name)
})

test('the step is held at 0.01 or more and the march stops under 1e-7 of transmittance', () => {
  assert.match(text, /max\(step,0\.01\)/)
  assert.match(text, /vec3f\(1\.0e-7\)/)
})

test('the march reads the lighting cache divided by the pre-exposure and the isotropic phase', () => {
  assert.match(text, /hvSampleLightingCache\(uvw\)\/hvPreExposure\(\)/)
  assert.match(text, /1\.0\/\(4\.0\*3\.14159265358979\)/)
})

test('the file keeps no backtick, which would end the template it is written in', () => {
  assert.equal(text.includes('`'), false)
})
