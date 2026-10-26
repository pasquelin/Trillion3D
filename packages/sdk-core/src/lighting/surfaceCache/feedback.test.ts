// Where in its tile an image writes the feedback (`feedbackTileJitter`, `feedback.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { feedbackTileJitter } from './feedback.ts'

test('the images of a tile cover its every place once, the first four its four quadrants', () => {
  const places = new Set<string>()
  for (let frame = 0; frame < 256; frame++) places.add(feedbackTileJitter(frame, 16).join(','))
  assert.equal(places.size, 256)
  assert.deepEqual(
    [0, 1, 2, 3].map((frame) => feedbackTileJitter(frame, 16)),
    [
      [0, 0],
      [0, 8],
      [8, 0],
      [8, 8],
    ],
  )
})

test('the sequence repeats with the tile’s square, and a tile of a pixel has one place', () => {
  assert.deepEqual(feedbackTileJitter(256 + 5, 16), feedbackTileJitter(5, 16))
  assert.deepEqual(feedbackTileJitter(5, 1), [0, 0])
  assert.deepEqual(
    [0, 1, 2, 3, 4].map((frame) => feedbackTileJitter(frame, 2)),
    [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
      [0, 0],
    ],
  )
})
