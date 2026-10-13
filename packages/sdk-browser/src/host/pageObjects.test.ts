// #78 lot 3: a material made at run time is the engine's own surface record, built at this
// boundary from the contract's parameters.
import test from 'node:test'
import assert from 'node:assert/strict'
import { materialSurface } from './pageObjects.ts'
import type { Material } from '../../../sdk-core/src/index.ts'
import { alphaModeFields } from './prepared/materials.ts'
import { surfaceSide } from '../page/surface.ts'

const CONTRACT: Material = {
  baseColor: [0.25, 0.5, 0.75],
  opacity: 0.5,
  metalness: 0.125,
  roughness: 0.875,
  emissive: [0, 1, 0],
  side: 'double',
  alphaMode: 'mask',
  alphaCutoff: 0.4,
}

test('a repainted surface draws its alpha mode by the one rule the open draws a table entry by', () => {
  for (const alphaMode of ['opaque', 'mask', 'blend'] as const) {
    const { transparent, depthWrite, alphaTest } = materialSurface(
      { ...CONTRACT, alphaMode },
      false,
    )
    assert.deepEqual(
      { transparent, depthWrite, alphaTest },
      alphaModeFields(alphaMode, CONTRACT.alphaCutoff),
      alphaMode,
    )
  }
})

test('a surface built from the contract declares the side, the cutoff and its colours', () => {
  const surface = materialSurface(CONTRACT, false)
  assert.equal(surfaceSide(surface), 'double')
  assert.equal(surface.alphaTest, 0.4, 'a masked surface carries its cutoff')
  assert.equal(surface.transparent, false, 'masking is not blending')
  assert.deepEqual(surface.baseColor, [0.25, 0.5, 0.75])
  assert.deepEqual([surface.metalness, surface.roughness, surface.opacity], [0.125, 0.875, 0.5])
  assert.deepEqual(surface.emissive, [0, 1, 0])
  assert.equal(surface.vertexColors, false)
  assert.equal(materialSurface(CONTRACT, true).vertexColors, true)
  const blended = materialSurface({ ...CONTRACT, alphaMode: 'blend' }, false)
  assert.equal(blended.transparent, true)
  assert.equal(blended.alphaTest, 0)
})
