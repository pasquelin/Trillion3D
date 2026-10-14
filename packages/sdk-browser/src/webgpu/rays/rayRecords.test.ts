// The records a ray decodes (`createRayRecords`): a cluster the pool holds is tested, drawn by a view
// or not — no row is read —; one the pool gives back is not; a line has no area; the records go up
// as the runs the pool's moves wrote.
import test from 'node:test'
import assert from 'node:assert/strict'
import { NO_INDEX } from '../../../../math/src/constants.ts'
import { FLAG_CLUSTER_PAGE } from '../../visibility/types.ts'
import type { WebgpuPagesCore } from '../pages/runtime.ts'
import type { CutTables } from '../../gpu/dag/cutReaders.ts'
import { createRayRecords, RECORD_DRAWABLE, RECORD_NO_AREA, RECORD_WORDS } from './rayRecords.ts'

/** Two placements of one cluster each, the second a line's: their records 3 and 5, no row held. */
function rig() {
  const slots = new Map<string, number>()
  const record = (url: string, lineWidth = 0) => ({
    url,
    attributes: {},
    geometryPage: { url, vertexCount: 3, indexCount: 3, flags: 0, bytes: 64 },
    material: { version: 0, lineWidth },
  })
  const recs = [record('a'), record('b', 2)]
  const rt = {
    layout: {
      recordOf: (page: number) => recs[page],
      rows: { offsetOf: (page: number) => slots.get(recs[page]?.url) ?? -1, rowsRevision: 0 },
      placement: { baseOfRoot: [0, 1], packedCount: 2 },
      packedPages: recs,
    },
    vis: { geometryBlocks: new Map() },
  } as unknown as WebgpuPagesCore
  const tables = {
    views: undefined,
    treeRoot: NO_INDEX,
    placements: 2,
    worldPlacement: NO_INDEX,
    recordCount: 8,
    cutLinks: [
      { pageBase: 0, pageCount: 1 },
      { pageBase: 1, pageCount: 1 },
    ],
    recordShift: new Uint32Array([3, 4]),
  } as unknown as CutTables
  return { records: createRayRecords(rt), tables, slots }
}

const flags = (words: Uint32Array, r: number) => words[r * RECORD_WORDS + 1]

test('a cluster the pool holds is tested out of every view; one it gives back is not', () => {
  const { records, tables, slots } = rig()
  slots.set('a', 40)
  assert.equal(records.sync(tables), true)
  const { words } = records
  assert.equal(words[3 * RECORD_WORDS], 41, 'its slot, plus one')
  assert.equal(flags(words, 3), FLAG_CLUSTER_PAGE | RECORD_DRAWABLE, 'tested with no row held')
  assert.equal(flags(words, 5) & RECORD_DRAWABLE, 0, 'out of the pool, not tested')
  assert.ok(flags(words, 5) & RECORD_NO_AREA, 'a line has no area')
  records.takeDirty()
  slots.delete('a')
  records.moved(0)
  assert.equal(flags(records.words, 3) & RECORD_DRAWABLE, 0, 'given back, not tested')
  assert.deepEqual([...records.takeDirty()], [3], 'one record to send')
  assert.equal(records.sync(tables), false, 'the table stands')
})

test("a record's slot is the cache's, read when the log names its page", () => {
  const { records, tables, slots } = rig()
  slots.set('a', 40)
  records.sync(tables)
  records.takeDirty()
  // The cache moved the page: the record holds nothing of its own, it reads the slot again there.
  slots.set('a', 80)
  records.moved(0)
  assert.equal(records.words[3 * RECORD_WORDS], 81, 'the slot the cache holds now, plus one')
  assert.ok(flags(records.words, 3) & RECORD_DRAWABLE, 'still in the pool, tested')
  assert.deepEqual([...records.takeDirty()], [3])
})
