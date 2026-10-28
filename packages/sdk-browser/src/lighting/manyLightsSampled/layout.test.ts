import test from 'node:test'
import assert from 'node:assert/strict'
import {
  sampledGeometry,
  guideAt,
  guideWords,
  samplesOfPixel,
  tileArgsAt,
  tileListWords,
} from './layout.ts'

test('a 1920 by 1080 view downsampled by 2 holds 960 by 540 pixels of 4 samples', () => {
  const g = sampledGeometry(1920, 1080, [2, 2], [2, 2])
  assert.deepEqual(g.tiles, [240, 135])
  assert.deepEqual(g.downsampledView, [960, 540])
  assert.deepEqual(g.downsampledTiles, [120, 68])
  assert.deepEqual(g.sampleView, [1920, 1080])
  assert.equal(samplesOfPixel(g), 4)
  assert.equal(g.tileListStride, 240 * 135)
})

test('odd sizes round up', () => {
  const g = sampledGeometry(101, 51, [2, 1], [2, 1])
  assert.deepEqual(g.downsampledView, [51, 51])
  assert.deepEqual(g.tiles, [13, 7])
  assert.deepEqual(g.sampleView, [102, 51])
})

test('the guide buffer holds the visible sets, the hidden sets, then the ratios', () => {
  const g = sampledGeometry(64, 64, [1, 1], [1, 1])
  const at = guideAt(g)
  assert.deepEqual(at, { visible: 0, hidden: 64 * 4, ratios: 64 * 6 })
  assert.equal(guideWords(g, 10), 64 * 6 + 10)
  assert.equal(tileListWords(g), 10 * 64)
  assert.equal(tileArgsAt(3), 36)
})
