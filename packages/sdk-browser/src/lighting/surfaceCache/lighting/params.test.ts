// The lighting's sizes (`params.ts`): what the reference defaults light, and the memory that follows the shape.

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  lightsPerTile,
  MAX_LIGHTS_PER_TILE,
} from '../../../../../sdk-core/src/lighting/surfaceCache/lightingMath.ts'
import { CONTEXT_ARGS, CONTEXT_AT, CONTEXT_HEADER_WORDS, contextLayout } from './layout.ts'
import { shapeOf, sizesOf } from './params.ts'
import { lightingSettings as settings } from './params.fixture.ts'

test('the lighting is sized by the reference defaults: an atlas of 4096 lights 8281 tiles directly and 4096 by radiosity', () => {
  const shape = shapeOf(settings, 4096, false)
  assert.equal(shape.directTiles, 91 ** 2)
  assert.equal(shape.indirectTiles, 64 ** 2)
  assert.equal(shape.maxLights, 8)
  assert.equal(shape.spacing, 4)
  assert.equal(shape.hemisphere, 4)
  // A probe a tile of 4 × 4 texels: four to a tile of the cards' tiles.
  assert.equal(shape.radiosityTiles, 4 * 64 ** 2)
  assert.equal(shape.probesPerTile, 1)
  assert.equal(shape.raysPerProbe, 16)
})

test('the memory follows the shape: the probes at the spacing, a square of rays a probe', () => {
  const sizes = sizesOf(shapeOf(settings, 4096, false))
  assert.equal(sizes.probeAtlas, 1024)
  assert.equal(sizes.traceAtlas, 4096)
  assert.equal(sizes.depthRangeWords, 91 ** 2)
  // The light tiles the cull appends, the compaction places and each tile lists: at most eight a tile of the list, two words each; and where each tile's begin.
  assert.equal(sizes.lightTileWords, 91 ** 2 * 8 * 2)
  assert.equal(sizes.cardTileOffsetWords, 91 ** 2 * 2)
  assert.equal(sizes.filteredWords, 4 * 64 ** 2 * 16)
  // The lists follow the header, one after the other, the pages' lists after the tiles'.
  const layout = contextLayout(10, 20, 30)
  assert.deepEqual(
    [
      layout.directAt,
      layout.indirectAt,
      layout.radiosityAt,
      layout.directPagesAt,
      layout.indirectPagesAt,
      layout.words,
    ],
    [
      CONTEXT_HEADER_WORDS,
      CONTEXT_HEADER_WORDS + 10,
      CONTEXT_HEADER_WORDS + 30,
      CONTEXT_HEADER_WORDS + 60,
      // A page list holds no more pages than its update has tiles.
      CONTEXT_HEADER_WORDS + 70,
      CONTEXT_HEADER_WORDS + 90,
    ],
  )
  assert.ok(
    CONTEXT_AT.args + Object.keys(CONTEXT_ARGS).length * 4 <= CONTEXT_HEADER_WORDS,
    'the dispatch arguments are in the header',
  )
  // Without radiosity nothing of it is made.
  const off = sizesOf(shapeOf({ ...settings, surfaceCacheRadiosity: false }, 4096, false))
  assert.deepEqual([off.probeAtlas, off.traceAtlas, off.filteredWords], [1, 1, 1])
})

test('a spacing under 4 puts a whole card tile in a radiosity tile, its probes many', () => {
  const shape = shapeOf({ ...settings, surfaceCacheRadiosityProbeSpacing: 2 }, 4096, false)
  assert.equal(shape.radiosityTiles, shape.indirectTiles)
  assert.equal(shape.probesPerTile, 16)
})

test('a tile’s lights are counted in arrays of the most a tile keeps', () => {
  assert.equal(MAX_LIGHTS_PER_TILE, lightsPerTile(1000))
})
