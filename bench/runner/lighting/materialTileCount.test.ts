// The material classes rasterise the tiles their pixels are in, not one full screen each;
// the pixels they shade — one evaluation per covered pixel — are the same. Counted over a small
// atrium, whose 32-pixel tiles are coarse: at 3456 × 2234 the same six draw 1.1 a pixel.
import test from 'node:test'
import assert from 'node:assert/strict'
import { countClassFragments } from './materialTileCount.ts'

test('six classes rasterise under four fragments a pixel where they drew six, none lost', () => {
  const { full, tiled, evaluations } = countClassFragments(240, 156, 6, 1)
  assert.equal(full, 6)
  assert.ok(tiled < 4, `${tiled} fragments a pixel`)
  // Every covered pixel lies in a tile its class draws.
  assert.ok(tiled >= evaluations && evaluations > 0.6, `${evaluations} evaluations a pixel`)
})
