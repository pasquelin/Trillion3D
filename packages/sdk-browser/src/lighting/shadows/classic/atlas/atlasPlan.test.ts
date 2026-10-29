import test from 'node:test'
import assert from 'node:assert/strict'
import {
  atlasBudget,
  cascadeResolutionIn,
  atlasTileAt,
  localTileSide,
  planAtlas,
  tileSide,
  ATLAS_MAP_WORDS,
  ATLAS_TILE_NO_DYNAMIC,
} from './atlasPlan.ts'
import { VSM_PAGE_TEXELS } from '../../vsm/constants.ts'

const tile = (words: Uint32Array, id: number) => {
  const at = atlasTileAt(id)
  return {
    x: words[at]! & 0xffff,
    y: words[at]! >>> 16,
    side: words[at + 1],
    mip: words[at + 2],
    on: words[at + 3],
  }
}

test('a tile holds whole pages', () => {
  assert.equal(tileSide(1), 128)
  assert.equal(tileSide(128), 128)
  assert.equal(tileSide(129), 256)
  assert.equal(localTileSide(4), 1024)
  assert.equal(localTileSide(7), 128)
})

test('tiles are placed along rows, the tallest first, a row as high as its first', () => {
  const plan = planAtlas(
    [
      { mapId: 0, mip: 0, side: 256 },
      { mapId: 1, mip: 3, side: 512 },
      { mapId: 2, mip: 3, side: 512 },
      { mapId: 3, mip: 0, side: 256 },
    ],
    4,
    1024,
  )
  assert.deepEqual(tile(plan.words, 1), { x: 0, y: 0, side: 512, mip: 3, on: 1 })
  assert.deepEqual(tile(plan.words, 2), { x: 512, y: 0, side: 512, mip: 3, on: 1 })
  assert.deepEqual(tile(plan.words, 0), { x: 0, y: 512, side: 256, mip: 0, on: 1 })
  assert.deepEqual(tile(plan.words, 3), { x: 256, y: 512, side: 256, mip: 0, on: 1 })
  assert.equal(plan.width, 1024)
  assert.equal(plan.height, 768)
  assert.equal(plan.placed, 4)
})

test('a map with no room opens another atlas, one too large is left out', () => {
  const plan = planAtlas(
    [
      { mapId: 0, mip: 0, side: 1024 },
      { mapId: 1, mip: 0, side: 1024 },
      { mapId: 2, mip: 0, side: 2048 },
      { mapId: 9, mip: 0, side: 128 },
    ],
    4,
    1024,
  )
  assert.deepEqual([...plan.left].sort(), [2, 9])
  assert.equal(plan.placed, 2)
  assert.equal(plan.pages, 2)
  assert.equal(plan.words[atlasTileAt(0) + 7], 0)
  assert.equal(plan.words[atlasTileAt(1) + 7], 1)
  assert.equal(plan.words[atlasTileAt(1)], 0)
})

test('the tile holds the flag that leaves the movable casters out', () => {
  const plan = planAtlas([{ mapId: 1, mip: 0, side: 128, noDynamic: true }], 2, 1024)
  assert.equal(plan.words[atlasTileAt(1) + 4], ATLAS_TILE_NO_DYNAMIC)
  assert.equal(plan.words[atlasTileAt(0) + 4], 0)
  assert.equal(plan.words.length, 2 * ATLAS_MAP_WORDS)
})

test('the tile holds the depth bias of its map as three floats', () => {
  const bias = { constant: 0.25, slope: 1.5, maxSlope: 1 }
  const plan = planAtlas([{ mapId: 0, mip: 0, side: 128, bias }], 2, 1024)
  const floats = new Float32Array(plan.words.buffer)
  const at = atlasTileAt(0)
  assert.deepEqual([floats[at + 8], floats[at + 9], floats[at + 10]], [0.25, 1.5, 1])
  assert.deepEqual([floats[atlasTileAt(1) + 8], floats[atlasTileAt(1) + 10]], [0, 0])
})

test('the atlas side is held to the device and to the memory of every layer, down to the page', () => {
  // 150 MB for two layers of 32-bit depth: a side of 4434 texels, 4352 to the page.
  assert.deepEqual(atlasBudget(16384, 150, true), { side: 4352, pages: 1 })
  assert.deepEqual(atlasBudget(2048, 150, true), { side: 2048, pages: 4 })
  assert.deepEqual(atlasBudget(16384, 0, true), { side: 128, pages: 1 })
  assert.deepEqual(atlasBudget(16384, 0, false), { side: 16384, pages: Infinity })
})

test('the atlases are no more than the memory affords: the maps past them are left out', () => {
  const maps = [0, 1, 2].map((mapId) => ({ mapId, mip: 0, side: 256 }))
  const plan = planAtlas(maps, 3, 256, 2)
  assert.equal(plan.pages, 2)
  assert.deepEqual(plan.left, [2])
})

test('every placed tile carries the size of the atlas', () => {
  const plan = planAtlas([{ mapId: 0, mip: 0, side: 256 }], 1, 1024)
  assert.deepEqual([plan.words[atlasTileAt(0) + 5], plan.words[atlasTileAt(0) + 6]], [256, 256])
})

test('cascades are drawn at a resolution their tile fits in the atlas, a page less than its side, never below a page', () => {
  assert.equal(cascadeResolutionIn(4096, 16384), 4096)
  assert.equal(cascadeResolutionIn(4096, 2048), 2048 - VSM_PAGE_TEXELS)
  assert.equal(cascadeResolutionIn(4096, 64), VSM_PAGE_TEXELS)
})
