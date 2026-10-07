import assert from 'node:assert/strict'
import test from 'node:test'
import { material } from '../../../../sdk-core/src/world/material/index.ts'
import { hostSurface, repaintHostSurface } from './worldSurface.ts'

test('anisotropy values reach the physical surface on creation and repaint', () => {
  const paint = material.meshPhysical({ anisotropy: 0.85, anisotropyRotation: 1.2 }),
    surface = hostSurface(paint, false, new Map())
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
    repaintHostSurface(surface, paint)
    assert.deepEqual(read(), [strength, rotation])
  }
  assert.ok(surface.version > version, 'the existing surface announces its changed values')
})

test('an undeclared anisotropy keeps its neutral defaults', () => {
  const paint = material.meshPhysical(),
    surface = hostSurface(paint, false, new Map())
  assert.deepEqual([surface.anisotropy, surface.anisotropyRotation], [0, 0])
  paint.roughness = 0.2
  repaintHostSurface(surface, paint)
  assert.deepEqual([surface.anisotropy, surface.anisotropyRotation], [0, 0])
})
