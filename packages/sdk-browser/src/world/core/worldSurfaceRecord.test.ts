// A world material's surface holds its texture records themselves: the engine record a pool, an
// atlas or a sampling word reads is the page's own texture, a write on it seen with no copy and no
// follow.
import test from 'node:test'
import assert from 'node:assert/strict'
import { material } from '../../../../sdk-core/src/world/material/index.ts'
import { Texture } from '../../../../sdk-core/src/world/texture/texture.ts'
import { hostSurface } from './worldSurface.ts'
import { importHostSurface } from '../../host/surfaceImport.ts'

test('the surface and the engine record are the page texture itself', () => {
  const map = new Texture({ width: 2, height: 2 }),
    normalMap = new Texture({ width: 2, height: 2 })
  const surface = hostSurface(material.meshStandard({ map, normalMap }), false)
  assert.equal(surface.map, map)
  const record = importHostSurface(surface)!
  assert.equal(record.map, map, 'the colour slot reads the page texture')
  assert.equal(record.normalMap, normalMap, 'the data slot too')
})

test('a sampling or placement write is in the record with no follow', () => {
  const map = new Texture({ width: 2, height: 2 })
  const record = importHostSurface(hostSurface(material.meshStandard({ map }), false))!.map!
  map.minFilter = 'nearest'
  map.repeat.set(3, 1)
  assert.equal(record.minFilter, 'nearest')
  assert.equal(record.transform[0], 3)
})
