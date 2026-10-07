// A resource the open session was not opened with is never silently left undrawn: its batch has
// no rows in the session, its meshes wait (`waiting`, what `worldContents.reopenNeeded` reads),
// and the next opening sizes it and seats every one of them on a row the session draws.
import test from 'node:test'
import assert from 'node:assert/strict'
import type { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts'
import { createWorldBatches } from './worldBatches.ts'
import type { Cut } from './worldCuts.ts'
import type { MaterialEntry } from './worldMaterials.ts'

const cutOf = (key: string) => ({ key, drawn: {} }) as unknown as Cut
const entry = { id: 0, key: 'm', material: {} } as unknown as MaterialEntry
const mesh = () => ({}) as Mesh

test('a batch the session was not opened with waits for the next opening, then is drawn', () => {
  const touched: number[] = []
  const batches = createWorldBatches((_, row) => touched.push(row))
  const first = mesh()
  batches.seat(first, cutOf('a'), entry)
  batches.reopen() // the first session opens on resource `a`
  assert.equal(batches.waiting(), false, 'every mesh of the opened batch holds a row')
  const late = mesh()
  assert.equal(batches.seat(late, cutOf('b'), entry), false, 'no row in a batch not opened')
  assert.equal(batches.waiting(), true, 'the world asks a reopening for it')
  assert.deepEqual(
    batches.growHeld(() => {}),
    [],
    'no session grows a batch it does not hold',
  )
  assert.equal(batches.waiting(), true)
  const opened = batches.reopen()
  assert.deepEqual(opened.map((batch) => batch.cut.key).sort(), ['a', 'b'])
  assert.equal(batches.waiting(), false, 'the next opening seats it')
  const seat = batches.seats.get(late)!
  assert.equal(seat.batch.cut.key, 'b')
  assert.ok(seat.row >= 0 && seat.batch.owners[seat.row] === late, 'on a row the session draws')
})

test('a batch no mesh wears any more leaves at the next opening', () => {
  const batches = createWorldBatches(() => {})
  const gone = mesh()
  batches.seat(gone, cutOf('a'), entry)
  batches.seat(mesh(), cutOf('b'), entry)
  batches.reopen()
  batches.unseat(gone)
  assert.deepEqual(
    batches.reopen().map((batch) => batch.cut.key),
    ['b'],
  )
})
