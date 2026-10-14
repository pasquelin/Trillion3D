// A world material's surface holds its texture records themselves: the engine record a pool, an
// atlas or a sampling word reads is the page's own texture, a write on it seen with no copy and no
// follow.
import test from 'node:test'
import assert from 'node:assert/strict'
import { material } from '../../../../sdk-core/src/world/material/index.ts'
import { Texture } from '../../../../sdk-core/src/world/texture/texture.ts'
import {
  hostSurface,
  RANK_READINGS,
  readingRank,
  repaintHostSurface,
  type SurfaceReading,
} from './worldSurface.ts'

test('the surface and the engine record are the page texture itself', () => {
  const map = new Texture({ width: 2, height: 2 }),
    normalMap = new Texture({ width: 2, height: 2 })
  const surface = hostSurface(material.meshStandard({ map, normalMap }), false)
  assert.equal(surface.map, map, 'the colour slot reads the page texture')
  assert.equal(surface.normalMap, normalMap, 'the data slot too')
})

test('a family reads only the maps its model reads: a Lambert surface carries no roughness map', () => {
  const roughnessMap = new Texture({ width: 2, height: 2 })
  const surface = hostSurface(material.meshLambert({ roughnessMap }), false)
  assert.equal(surface.roughnessMap, undefined)
  assert.equal(surface.lit, true)
})

test('a sampling or placement write is in the record with no follow', () => {
  const map = new Texture({ width: 2, height: 2 })
  const record = hostSurface(material.meshStandard({ map }), false).map!
  map.minFilter = 'nearest'
  map.repeat.set(3, 1)
  assert.equal(record.minFilter, 'nearest')
  assert.equal(record.transform[0], 3)
})

test('an entry rank names the reading a repaint declares its surface with again, no side table', () => {
  const readings: SurfaceReading[] = ['faces', 'lines', 'sprite', 'sheet']
  for (const reading of readings)
    for (const tinted of [false, true])
      assert.equal(RANK_READINGS[readingRank(reading, tinted)], reading, `${reading} ${tinted}`)
  assert.deepEqual([readingRank('faces', true), readingRank('sheet', true)], [1, 5])
  const dashed = material.lineDashed({ linewidth: 3, dashSize: 2, gapSize: 1 }),
    surface = hostSurface(dashed, true, 'lines')
  dashed.linewidth = 5
  repaintHostSurface(surface, dashed, RANK_READINGS[readingRank('lines', true)])
  assert.deepEqual([surface.lineWidth, surface.dashSize, surface.vertexColors], [5, 2, true])
  assert.equal(surface.side, 'double', 'still a line quad, both sides once')
})
