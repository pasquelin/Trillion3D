// One write among ten thousand textures visits one slot: the headers follow the records written
// since the last render (`samplingHeaders`), never a walk of every slot.
import test from 'node:test'
import assert from 'node:assert/strict'
import { samplingHeaders } from './samplingHeaders.ts'
import type { WebgpuTileAtlas } from './atlas.ts'
import { Texture } from '../../../../sdk-core/src/world/texture/texture.ts'
import { closeTextureJournal, openTextureJournal } from '../../../../sdk-core/src/texture/writes.ts'

/** An atlas of `records`, after its fill slot, counting the headers it is asked to write. */
function atlas(records: Texture[]) {
  const set: number[] = []
  const textures = [undefined, ...records].map((texture) => ({
    texture,
    source: { kind: 'bytes' },
  }))
  const pages = {
    words: new Uint32Array(4096),
    setSampling: (slot: number) => (set.push(slot), true),
  }
  return { atlas: { textures, pages } as unknown as WebgpuTileAtlas, set }
}

test('one write among ten thousand textures visits one slot', () => {
  const records = Array.from({ length: 10_000 }, () => new Texture(null))
  const colour = atlas(records),
    data = atlas([])
  const journal = openTextureJournal()
  const follow = samplingHeaders(colour.atlas, data.atlas, journal, new Set())
  follow(true)
  assert.equal(colour.set.length, 10_000, 'the first follow writes every header once')
  colour.set.length = 0
  let visits = 0
  const record = records[6789]
  for (const each of records)
    // A visit reads the record's placement: a filter write never touches it.
    Object.defineProperty(each, 'placement', { get: () => (visits++, 0), configurable: true })
  follow(false)
  assert.equal(visits, 0, 'nothing written: no slot visited')
  record.minFilter = 'nearest'
  follow(false)
  assert.equal(visits, 1, 'one record written: one slot visited')
  assert.deepEqual(colour.set, [6790])
  closeTextureJournal(journal)
})

// A still scene weighs no coverage rule: the host maps' rules are read again only where a reader
// was filed again, or on a sync. Old code: every render weighed every host colour map's readers.
test('a still scene weighs no host map’s coverage rule', () => {
  let weighed = 0
  const readers = { cutoff: () => (weighed++, 128), follow() {} }
  const map = new Texture(null)
  const colour = atlas([map]),
    data = atlas([])
  ;(colour.atlas.textures[1] as { source: unknown }).source = {
    kind: 'host',
    map,
    coverage: readers,
  }
  const journal = openTextureJournal()
  const surfaces = new Set<never>()
  const follow = samplingHeaders(colour.atlas, data.atlas, journal, surfaces)
  const copies = { refresh: () => true, reduce: () => true }
  follow(true, new Set(), copies)
  weighed = 0
  for (let image = 0; image < 4; image++) follow(false, new Set(), copies)
  assert.equal(weighed, 0, 'nothing filed: no rule weighed')
  surfaces.add(undefined as never)
  follow(false, new Set(), copies)
  assert.equal(weighed, 1, 'a reader filed: its maps weighed once')
  closeTextureJournal(journal)
})
