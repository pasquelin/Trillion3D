// The row table grows in place. Its visibility rows keep their ranks and words; the blended
// casters' rows move behind the new visibility rows.
import { runsOf } from './dirty.fixture.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createWebgpuRowSync } from './sync.ts'
import { ROW_FLAGS_WORD } from './pageRow.ts'
import { FLAG_BLEND_CASTER, ROW_WORDS } from '../../visibility/types.ts'
import { catalogue, mount } from './blendCasters.fixture.ts'
import { closeAlone, MIRROR } from './rowCache.fixture.ts'

test('caster rows follow blendFirst after a grow, and the visibility rows keep their ranks', () => {
  const pages = catalogue(0.4)
  const { rows, writer } = mount(pages, 1)
  const sync = createWebgpuRowSync(rows, MIRROR, pages, () => true, writer, closeAlone)
  const casters = sync.blendCasters
  sync.syncRows()
  // One visibility row, the opaque triangle's; the blended one casts from the row behind it.
  assert.deepEqual([rows.rowOf(0), rows.blendRowOf(1), rows.blendFirst], [0, 1, 1])
  const opaqueWords = Array.from(rows.pageTableInts!.subarray(0, ROW_WORDS))
  rows.grow(3, 2)
  rows.clearDirty()
  sync.syncRows()
  assert.deepEqual([rows.blendFirst, rows.casterSlots, rows.generation], [3, 5, 1])
  assert.equal(rows.rowOf(0), 0, 'the opaque page keeps its rank')
  assert.deepEqual(Array.from(rows.pageTableInts!.subarray(0, ROW_WORDS)), opaqueWords)
  assert.equal(rows.packedRecs[0], pages[0])
  assert.equal(rows.blendRowOf(1), 3, 'the first caster row behind the new visibility rows')
  assert.equal(rows.packedRecs[3], pages[1])
  assert.equal(rows.packedRecs[1], undefined, 'its old row is a free visibility row now')
  assert.ok(rows.pageTableInts![3 * ROW_WORDS + ROW_FLAGS_WORD] & FLAG_BLEND_CASTER)
  assert.ok(
    runsOf(rows.forEachDirtyRun).some(([from, to]) => from <= 3 && 3 <= to),
    'the caster row is uploaded again',
  )
  assert.equal(casters.used, 1)
})

test('a grown table marks every row dirty, and the rows past the old table are empty', () => {
  const pages = catalogue(0.4, false)
  const { rows } = mount(pages, 0)
  rows.clearDirty()
  rows.grow(4, 0)
  assert.deepEqual(runsOf(rows.forEachDirtyRun), [[0, 3]])
  assert.deepEqual(Array.from(rows.rowPageIndex), [-1, -1, -1, -1])
  assert.equal(rows.pageTableFloats!.length, 4 * ROW_WORDS)
  assert.equal(rows.packedRecs.length, 4)
})
