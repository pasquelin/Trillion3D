import assert from 'node:assert/strict'
import test from 'node:test'
import { material } from '../../../../../sdk-core/src/world/material/index.ts'
import { hostSurface, repaintHostSurface } from './surface.ts'

test('anisotropy values reach the physical surface on creation and repaint', () => {
  const paint = material.meshPhysical({ anisotropy: 0.85, anisotropyRotation: 1.2 }),
    surface = hostSurface(paint)
  const read = () => [surface.anisotropy, surface.anisotropyRotation]
  assert.deepEqual(read(), [0.85, 1.2])
  const version = surface.version
  for (const [strength, rotation] of [
    [0.4, -0.7],
    [0, 2],
    [1, 0],
  ]) {
    paint.anisotropy = strength
    paint.anisotropyRotation = rotation
    repaintHostSurface(surface, paint, 'faces')
    assert.deepEqual(read(), [strength, rotation])
  }
  assert.ok(surface.version > version, 'the existing surface announces its changed values')
})

test('an undeclared anisotropy keeps its neutral defaults', () => {
  const paint = material.meshPhysical(),
    surface = hostSurface(paint)
  assert.deepEqual([surface.anisotropy, surface.anisotropyRotation], [0, 0])
  paint.roughness = 0.2
  repaintHostSurface(surface, paint, 'faces')
  assert.deepEqual([surface.anisotropy, surface.anisotropyRotation], [0, 0])
})

test('a sheen above zero declares the cloth, a coat or a transmission takes the surface first', () => {
  const paint = material.meshPhysical({ sheen: 1, sheenColor: 0xff0000, sheenRoughness: 0.4 }),
    surface = hostSurface(paint)
  assert.deepEqual([surface.sheen, surface.sheenRoughness, surface.sheenColor], [1, 0.4, [1, 0, 0]])
  paint.clearcoat = 0.5
  repaintHostSurface(surface, paint, 'faces')
  assert.deepEqual([surface.sheen, surface.sheenRoughness, surface.sheenColor], [0, 0, [0, 0, 0]])
  paint.clearcoat = 0
  paint.transmission = 0.5
  repaintHostSurface(surface, paint, 'faces')
  assert.equal(surface.sheen, 0)
  paint.transmission = 0
  repaintHostSurface(surface, paint, 'faces')
  assert.equal(surface.sheen, 1)
})

test('a sheen roughness alone declares no cloth', () => {
  const surface = hostSurface(material.meshPhysical({ sheenRoughness: 0.4 }))
  assert.deepEqual([surface.sheen, surface.sheenRoughness], [0, 0])
})

test('a declared specular, a zero too, makes the surface physical and reaches it; undeclared, none', () => {
  const paint = material.meshPhysical({ specularIntensity: 0 }),
    surface = hostSurface(paint)
  assert.deepEqual([surface.family, surface.specularIntensity], ['physical', 0])
  paint.specularIntensity = 0.75
  repaintHostSurface(surface, paint, 'faces')
  assert.equal(surface.specularIntensity, 0.75)
  assert.equal(hostSurface(material.meshPhysical()).specularIntensity, undefined)
})
