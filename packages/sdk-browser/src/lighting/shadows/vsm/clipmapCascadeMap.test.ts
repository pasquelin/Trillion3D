// A classic cascade's own map over a clipmap level (`vsmClipmapCascadeMap`): the level's geometry by copy, a map, a page table place and a cache record of its own.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createVsmClipmap, vsmClipmapCascadeMap } from './clipmap.ts'
import { VsmCacheManager } from './cacheManager.ts'
import { SUN, PROJECTION, VIEW, LEVELS } from './clipmap.fixture.ts'

const clipmapWith = (cascadeMaps: number) =>
  createVsmClipmap(
    new VsmCacheManager(),
    { ...SUN, cascadeMaps },
    { view: VIEW, projection: PROJECTION, perspective: true, eye: [0, 0, 0] },
    { width: 1024, height: 1024 },
  )

test('the entry holds a map more for each cascade, past the levels', () => {
  const clipmap = clipmapWith(3)
  assert.equal(clipmap.levels.length, LEVELS)
  assert.equal(clipmap.cacheEntry.mapCaches.length, LEVELS + 3)
})

test('two cascades of one level are two maps over the same geometry, each with its own table place and record', () => {
  const clipmap = clipmapWith(2)
  const { mapCaches } = clipmap.cacheEntry
  mapCaches[LEVELS].projectionData.tableOrigin = 11
  mapCaches[LEVELS + 1].projectionData.tableOrigin = 22
  const a = vsmClipmapCascadeMap(clipmap, 4, LEVELS, false)
  const b = vsmClipmapCascadeMap(clipmap, 4, LEVELS + 1, false)
  const level = mapCaches[4].projectionData
  for (const map of [a, b]) {
    assert.deepEqual([...map.projectionData.shiftedToMapUv], [...level.shiftedToMapUv])
    assert.equal(map.projectionData.mapLevel, level.mapLevel)
    assert.equal(map.projectionData.levelsLeft, 1, 'a cascade’s map has no coarser level after it')
  }
  assert.notEqual(a, b)
  assert.deepEqual([a.projectionData.tableOrigin, b.projectionData.tableOrigin], [11, 22])
  assert.equal(level.levelsLeft, LEVELS - 4, 'the level itself is left as it was')
})
