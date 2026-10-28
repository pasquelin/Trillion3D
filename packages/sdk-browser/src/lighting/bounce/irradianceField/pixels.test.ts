// The irradiance field's pixels: the tile of pixels one of which reports the interpolation misses, and the pixel it picks each frame.
import test from 'node:test'
import assert from 'node:assert/strict'
import { feedbackTileJitter, feedbackTileSize } from './pixelsTile.ts'

test('the feedback tile is a power of two from 1 to 256', () => {
  assert.deepEqual([0, 1, 3, 8, 9, 256, 1000].map(feedbackTileSize), [1, 1, 4, 8, 16, 256, 256])
})

test('every pixel of a tile reports in turn, spread over the tile, the pixel of a tile of one at its corner', () => {
  assert.deepEqual(feedbackTileJitter(1, 7), [0, 0])
  for (const tile of [2, 4, 8]) {
    const seen = new Set<string>()
    for (let frame = 0; frame < tile * tile; frame++) {
      const [x, y] = feedbackTileJitter(tile, frame)
      assert.ok(x >= 0 && x < tile && y >= 0 && y < tile, `${tile} ${frame}`)
      seen.add(`${x},${y}`)
    }
    assert.equal(
      seen.size,
      tile * tile,
      `a tile of ${tile}: each pixel once in ${tile * tile} frames`,
    )
    assert.deepEqual(
      feedbackTileJitter(tile, 3),
      feedbackTileJitter(tile, 3 + tile * tile),
      'the sequence turns',
    )
  }
  assert.deepEqual(
    [0, 1, 2, 3].map((frame) => feedbackTileJitter(2, frame)),
    [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ],
  )
})
