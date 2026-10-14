// A world material's surface holds its texture records themselves: the engine record a pool, an
// atlas or a sampling word reads is the page's own texture, a write on it seen with no copy and no
// follow.
import test from 'node:test'
import assert from 'node:assert/strict'
import { material } from '../../../../sdk-core/src/world/material/index.ts'
import { Texture } from '../../../../sdk-core/src/world/texture/texture.ts'
import { hostSurface, repaintHostSurface } from './worldSurface.ts'
import { surfaceVariant } from '../../page/surfaceVariant.ts'

test('the surface and the engine record are the page texture itself', () => {
  const map = new Texture({ width: 2, height: 2 }),
    normalMap = new Texture({ width: 2, height: 2 })
  const surface = hostSurface(material.meshStandard({ map, normalMap }))
  assert.equal(surface.map, map, 'the colour slot reads the page texture')
  assert.equal(surface.normalMap, normalMap, 'the data slot too')
})

test('a family reads only the maps its model reads: a Lambert surface carries no roughness map', () => {
  const roughnessMap = new Texture({ width: 2, height: 2 })
  const surface = hostSurface(material.meshLambert({ roughnessMap }))
  assert.equal(surface.roughnessMap, undefined)
  assert.equal(surface.lit, true)
})

test('a sampling or placement write is in the record with no follow', () => {
  const map = new Texture({ width: 2, height: 2 })
  const record = hostSurface(material.meshStandard({ map })).map!
  map.minFilter = 'nearest'
  map.repeat.set(3, 1)
  assert.equal(record.minFilter, 'nearest')
  assert.equal(record.transform[0], 3)
})

test('a repaint declares a surface again as its reading, a tinted variant keeping its colours', () => {
  const dashed = material.lineDashed({ linewidth: 3, dashSize: 2, gapSize: 1 }),
    plain = hostSurface(dashed, 'lines'),
    tinted = surfaceVariant(plain, new Map(), {
      vertexColors: true,
      flatShading: false,
      twoSided: false,
    })
  dashed.linewidth = 5
  for (const surface of [plain, tinted]) repaintHostSurface(surface, dashed, 'lines')
  assert.deepEqual(
    [plain, tinted].map((surface) => [surface.lineWidth, surface.dashSize, surface.vertexColors]),
    [
      [5, 2, false],
      [5, 2, true],
    ],
  )
  assert.equal(tinted.side, 'double', 'still a line quad, both sides once')
})
