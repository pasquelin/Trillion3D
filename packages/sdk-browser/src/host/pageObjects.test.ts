// #78 lot 3: a material made at run time is a surface of the engine's own graph, built at this
// boundary from the contract's parameters.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from './graph/graph.fixture.ts'
import { hostPageSurface } from './pageObjects.ts'
import type { Material } from '../../../sdk-core/src/index.ts'
import { alphaModeFields } from './prepared/materials.ts'

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
    const surface = hostPageSurface({ ...CONTRACT, alphaMode }, false) as unknown as G.GraphSurface
    const { transparent, depthWrite, alphaTest } = surface
    assert.deepEqual(
      { transparent, depthWrite, alphaTest },
      alphaModeFields(alphaMode, CONTRACT.alphaCutoff),
      alphaMode,
    )
  }
})

test('a surface built from the contract declares the host side, the cutoff and its colours', () => {
  const surface = hostPageSurface(CONTRACT, false)
  const host = surface as unknown as G.GraphSurface
  assert.equal(host.side, G.DOUBLE_SIDE)
  assert.equal(host.alphaTest, 0.4, 'a masked surface carries its cutoff')
  assert.equal(host.transparent, false, 'masking is not blending')
  assert.deepEqual((host.color as G.Color).toArray(), [0.25, 0.5, 0.75])
  assert.deepEqual([host.metalness, host.roughness, host.opacity], [0.125, 0.875, 0.5])
  assert.equal(host.vertexColors, false)
  assert.equal((hostPageSurface(CONTRACT, true) as unknown as G.GraphSurface).vertexColors, true)
  const blended = hostPageSurface({ ...CONTRACT, alphaMode: 'blend' }, false)
  assert.equal((blended as unknown as G.GraphSurface).transparent, true)
  assert.equal((blended as unknown as G.GraphSurface).alphaTest, 0)
})
