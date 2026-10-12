// A resource the open session was not opened with is never silently left undrawn: its batch has
// no rows in the session, its meshes wait (`waiting`, what `worldContents.reopenNeeded` reads),
// and the next opening sizes it and seats every one of them on a row the session draws.
import test from 'node:test'
import assert from 'node:assert/strict'
import type { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts'
import { createWorldBatches } from './worldBatches.ts'
import type { Cut } from './worldCuts.ts'
import type { MaterialEntry } from './worldMaterials.ts'
import { createWorldRanks } from './worldRanks.ts'

const cutOf = (key: string) =>
  ({ key, drawn: {}, runtime: { primitive: { key } } }) as unknown as Cut
const entry = { id: 0, key: 'm', material: {} } as unknown as MaterialEntry
const mesh = () => ({}) as Mesh
const wear = () => ({}) as never

test('a batch the session was not opened with waits for the next opening, then is drawn', () => {
  const touched: number[] = []
  const batches = createWorldBatches((_, row) => touched.push(row), wear, createWorldRanks())
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
  const batches = createWorldBatches(() => {}, wear, createWorldRanks())
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

test('a batch keeps the order it was given at its first seat, whichever batches leave', () => {
  const batches = createWorldBatches(() => {}, wear, createWorldRanks())
  const [a, b, c] = [mesh(), mesh(), mesh()]
  batches.seat(a, cutOf('a'), entry)
  batches.seat(b, cutOf('b'), entry)
  const first = batches.reopen()
  assert.deepEqual(
    first.map((batch) => batch.order),
    [0, 1],
  )
  batches.unseat(a)
  batches.seat(c, cutOf('c'), entry)
  assert.deepEqual(
    batches.reopen().map((batch) => [batch.cut.key, batch.order]),
    [
      ['b', 1],
      ['c', 2],
    ],
  )
})

test('a batch the session was not opened with is handed to it, seated, and waits for nothing', async () => {
  const handed: unknown[] = []
  const grow = {
    growsInPlace: () => true,
    growPlacements() {},
    addPlacements: (batch: unknown, primitive: unknown) => (
      handed.push([batch, primitive]),
      Promise.resolve(true)
    ),
  }
  const batches = createWorldBatches(() => {}, wear, createWorldRanks())
  batches.seat(mesh(), cutOf('a'), entry)
  batches.reopen()
  const late = mesh()
  batches.seat(late, cutOf('b'), entry)
  const seated: Mesh[] = []
  const joined = batches.join((each) => seated.push(each), grow)
  assert.deepEqual(
    joined.map((batch) => batch.cut.key),
    ['b'],
  )
  assert.deepEqual(seated, [late], 'its mesh holds a row')
  assert.deepEqual(handed, [[joined[0], { key: 'b' }]], 'the session heard it once')
  assert.equal(batches.waiting(), false)
  await Promise.resolve()
  assert.equal(batches.waiting(), false, 'taken: no opening is asked')
})

test('a batch the session refuses asks for an opening, which takes it', async () => {
  let asked = 0
  const grow = {
    growsInPlace: () => true,
    growPlacements() {},
    addPlacements: () => Promise.resolve(false),
  }
  const batches = createWorldBatches(
    () => {},
    wear,
    createWorldRanks(),
    () => asked++,
  )
  batches.seat(mesh(), cutOf('a'), entry)
  batches.reopen()
  batches.seat(mesh(), cutOf('b'), entry)
  batches.join(() => {}, grow)
  await new Promise((resolve) => setTimeout(resolve))
  assert.equal(asked, 1)
  assert.equal(batches.waiting(), true)
  batches.reopen()
  assert.equal(batches.waiting(), false)
})
