import test from 'node:test'
import assert from 'node:assert/strict'
import { frontTileBytes, frontTileGrid } from './frontTiles.ts'
import { blendFrontShader } from '../../blend/frontStageWgsl.ts'

test('the grid covers the view in tiles of eight pixels', () => {
  assert.deepEqual(frontTileGrid(1920, 1080), [240, 135])
  assert.deepEqual(frontTileGrid(1921, 1081), [241, 136])
  assert.equal(frontTileBytes(16, 8), 2 * 4 * 2 + 32)
})

test('only the front stage that lights the layer marks tiles', () => {
  assert.match(blendFrontShader(3), /textureStore\(frontTileMask,/)
  for (const outputs of [0, 1, 2] as const)
    assert.doesNotMatch(blendFrontShader(outputs), /frontTileMask/)
})
