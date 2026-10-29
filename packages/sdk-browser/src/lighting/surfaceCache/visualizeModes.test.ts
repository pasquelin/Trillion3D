import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isLayerMode,
  tileRectOf,
  visualizeDrawsOf,
  visualizeHitIsColour,
  visualizeLayersOf,
  visualizeOutputOf,
  VISUALIZE_MODE,
} from './visualizeModes.ts'

test('the overview draws the geometry normals, the reflection view and the coverage in three tiles of a row', () => {
  const draws = visualizeDrawsOf(VISUALIZE_MODE.overview)
  assert.deepEqual(
    draws.map((draw) => draw.mode),
    [VISUALIZE_MODE.geometryNormals, VISUALIZE_MODE.reflectionView, VISUALIZE_MODE.surfaceCache],
  )
  assert.deepEqual(visualizeDrawsOf(VISUALIZE_MODE.albedo), [
    { mode: VISUALIZE_MODE.albedo, tile: -1, perRow: 1 },
  ])
})

test('a tile is a third of the display less the margins, the next one a margin along', () => {
  const size = [1000, 600] as const
  const first = tileRectOf(size, 0, 3)
  const second = tileRectOf(size, 1, 3)
  assert.equal(first.width, Math.floor((1000 - 4 * 4) / 3))
  assert.equal(first.x, 4)
  assert.equal(second.x, first.width + 8)
  assert.deepEqual(tileRectOf(size, -1, 1), { x: 0, y: 0, width: 1000, height: 600 })
})

test('a mode reads the layers it names and shows its value as the reference does', () => {
  assert.deepEqual(visualizeLayersOf(VISUALIZE_MODE.directLighting), ['direct'])
  assert.deepEqual(visualizeLayersOf(VISUALIZE_MODE.cardWeights), [])
  assert.equal(isLayerMode(VISUALIZE_MODE.scene), false)
  assert.equal(visualizeOutputOf(VISUALIZE_MODE.albedo), 'srgb')
  assert.equal(visualizeOutputOf(VISUALIZE_MODE.normals), 'raw')
  assert.equal(visualizeOutputOf(VISUALIZE_MODE.directLighting), 'radiance')
  assert.equal(visualizeHitIsColour(VISUALIZE_MODE.directLighting), false)
  assert.equal(visualizeHitIsColour(VISUALIZE_MODE.cardWeights), true)
  assert.equal(visualizeHitIsColour(VISUALIZE_MODE.geometryNormals), true)
})
