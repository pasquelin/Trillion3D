// A toon material is a standard surface of the toon shading model (`physicalSurface.ts`): the model's number in its record, its profile's row, no family
// of its own; a Lambert or a Phong surface is not one.
import test from 'node:test'
import assert from 'node:assert/strict'
import { material } from '../../../../../sdk-core/src/world/material/index.ts'
import { PIXEL_MODEL, shadingModelOfName } from '../../../materials/surface/pixelModel.ts'
import { shadingModelCode } from '../../../materials/surface/shadingModelCode.ts'
import { hostSurface } from './surface.ts'

test('a toon material is a standard surface of the toon model, on the default profile’s row unless it names one', () => {
  const plain = hostSurface(material.meshToon())
  assert.equal(plain.shadingModel, PIXEL_MODEL.toon)
  assert.equal(plain.subsurfaceProfile, 0)
  assert.equal(plain.lit, true)
  assert.notEqual(plain.family, 'toon')
  const named = hostSurface(material.meshToon({ toonProfile: { diffuseIndirectScale: 0.42 } }))
  assert.ok(named.subsurfaceProfile! > 0)
  assert.equal(
    hostSurface(material.meshToon({ toonProfile: { diffuseIndirectScale: 0.42 } }))
      .subsurfaceProfile,
    named.subsurfaceProfile,
    'the same profile, the same row',
  )
})

test('another model reads its subsurface profile, never the toon profile', () => {
  const lambert = hostSurface(material.meshLambert({ toonProfile: { diffuseIndirectScale: 0.7 } }))
  assert.equal(lambert.shadingModel, undefined)
  const standard = hostSurface(
    material.meshStandard({ toonProfile: { diffuseIndirectScale: 0.8 } }),
  )
  assert.equal(standard.shadingModel, undefined)
  assert.equal(standard.subsurfaceProfile, 0)
})

test('the toon model has a code in the record of its own and a number no graph outputs', () => {
  assert.equal(PIXEL_MODEL.toon, 12)
  assert.equal(shadingModelOfName('toon'), PIXEL_MODEL.toon)
  assert.equal(shadingModelCode(PIXEL_MODEL.toon), 7)
  const codes = [1, 2, 3, 4, 5, 6, 7]
  const numbers = [
    PIXEL_MODEL.skin,
    PIXEL_MODEL.profile,
    PIXEL_MODEL.eye,
    PIXEL_MODEL.hair,
    0,
    PIXEL_MODEL.subsurface,
    PIXEL_MODEL.toon,
  ]
  numbers.forEach((number, i) => assert.equal(shadingModelCode(number), codes[i]))
})
