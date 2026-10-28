// The pixels the shadow maps treat as subsurface (`subsurfaceModelWgsl.ts`): the thin transmission and every
// shading model a pixel carries (subsurface, preintegrated skin, subsurface profile, hair, eye) keep their
// back faces in the marking and the projection; only the thin transmission lets light through its shadow.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import { PIXEL_MODEL, PIXEL_MODEL_SHIFT } from '../../../materials/surface/pixelModel.ts'
import { SUBSURFACE_FLAG } from '../../../materials/surface/subsurface.ts'
import { vsmSubsurfaceModel, vsmTransmitsShadow } from './subsurfaceModelWgsl.ts'

const subsurface = shaderRun<{ vsmSubsurfaceModel(flags: number): boolean }>(
  vsmSubsurfaceModel,
  ['vsmSubsurfaceModel'],
  {},
).vsmSubsurfaceModel
const transmits = shaderRun<{ vsmTransmitsShadow(flags: number): boolean }>(
  vsmTransmitsShadow,
  ['vsmTransmitsShadow'],
  {},
).vsmTransmitsShadow

test('every shading model a pixel carries, and the thin transmission, is a subsurface pixel; a plain one is not', () => {
  for (const [name, model] of Object.entries(PIXEL_MODEL))
    assert.equal(subsurface((model << PIXEL_MODEL_SHIFT) >>> 0), true, name)
  assert.equal(subsurface(SUBSURFACE_FLAG), true, 'the thin transmission')
  assert.equal(subsurface(0), false, 'no model')
  assert.equal(subsurface(1 | 2), false, 'plain flags')
})

test('only the thin transmission lets light through its shadow, whatever the model', () => {
  assert.equal(transmits(SUBSURFACE_FLAG), true)
  for (const model of Object.values(PIXEL_MODEL))
    assert.equal(transmits((model << PIXEL_MODEL_SHIFT) >>> 0), false)
})
