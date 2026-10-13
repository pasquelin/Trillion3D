// A moving image sums every light of its cell, as a still one does: the resolve reads no image
// rank, draws no subset, and its one call site of the light loop is the full sum.
import test from 'node:test'
import assert from 'node:assert/strict'
import { directLightingWgsl } from './lightingWgsl.ts'
import { shaderFunctions, wgslConstants } from '../../texture/shaderRule.fixture.ts'
import {
  BOUNCE_LIGHTING_SHADER,
  DIRECT_LIGHTING_SHADER,
} from '../../gpu/core/shaderTexts.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'

const DIRECT_LIGHTING_WGSL = wgslModule(directLightingWgsl())

test('the resolve reads no image rank and holds no drawn sum', () => {
  for (const shader of [DIRECT_LIGHTING_WGSL, DIRECT_LIGHTING_SHADER, BOUNCE_LIGHTING_SHADER]) {
    assert.ok(!shader.includes('viewport.w'), 'no rank read')
    for (const name of ['sampledSliceLighting', 'sampledList', 'lightWeight', 'LIGHT_SAMPLES'])
      assert.ok(!shader.includes(name), name)
  }
})

test('every listed cell, shadowed or not, takes the full sum of its list', () => {
  const K = wgslConstants(DIRECT_LIGHTING_WGSL)
  const sums: number[][] = []
  const { contractLighting } = shaderFunctions<{
    contractLighting: (...args: unknown[]) => unknown
  }>(DIRECT_LIGHTING_WGSL, ['contractLighting'], {
    ...K,
    vec3f: () => 0,
    cellSlice: (cell: number) => ({ x: cell, y: 70 }),
    sliceLighting: (...args: unknown[]) => sums.push([(args[7] as { x: number }).x]),
  })
  for (const cell of [0, 3, 0x80000002]) contractLighting(0, 0, 0, 0, 0, 0, 0, cell)
  assert.deepEqual(sums, [[0], [3], [0x80000002]])
  contractLighting(0, 0, 0, 0, 0, 0, 0, K.TILE_NO_SLICE)
  assert.equal(sums.length, 3, 'a pixel with no list sums nothing')
})
