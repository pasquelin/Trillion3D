import test from 'node:test'
import assert from 'node:assert/strict'
import { check, frame, keysOf, queueOf, scene } from './sets.fixture.ts'

test('the incremental sets answer what the whole-set version answered, image after image', () => {
  const world = scene()
  const room = 64
  // A camera that moves: the cut grows, slides, shrinks, empties and comes back — and it names
  // transparent clusters (16 to 19) exactly as it names opaque ones.
  const cuts: number[][] = [
    [0, 1, 2, 3, 16],
    [0, 1, 2, 3, 16],
    [2, 3, 4, 5, 6, 16, 17],
    [6, 7, 8, 9, 10, 11, 18],
    [],
    [1, 3, 5, 7, 9, 11, 13, 15, 16, 17, 18, 19],
    [0, 2, 4, 19],
  ]
  cuts.forEach((ids, index) => check(world, ids, room, `image ${index}`))
})

test('a cut wider than the page budget keeps the same coarse subset as the whole-set version', () => {
  const world = scene()
  for (const room of [0, 1, 3, 6, 9, 14]) {
    const world2 = scene()
    check(world2, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 16, 17, 18, 19], room, `budget ${room}`)
    check(world2, [4, 5, 6, 7, 8, 9, 10, 11, 16, 17], room, `budget ${room} bis`)
    // Back under the budget: the queue is the desired set again.
    check(world2, [0, 1, 16], 64, `budget ${room} released`)
  }
  assert.equal(world.tracking.wanted.count, 0)
})

test('the CPU cut goes through the same delta, and the GPU resumes against it', () => {
  const world = scene()
  const { tracking, delta, packed, bootstrapKey } = world
  frame(world, [0, 1, 2, 3, 16], 64)
  // It names its records and not ranks; the delta draws the same ranks from them, and the sets move
  // by what moved — neither emptied nor rebuilt.
  delta.adoptRecords([packed[10], packed[11], packed[19]], (rec) => packed.indexOf(rec))
  world.cut()
  world.budget(64)
  assert.deepEqual(
    keysOf(tracking.wanted),
    new Set(
      [packed[10], packed[11], packed[19]].map(tracking.keyOf).filter((k) => !bootstrapKey[k]),
    ),
  )
  assert.equal(delta.exitedCount, 5, 'the five pages of the previous cut have left')
  // The GPU takes the image back: its delta starts from what the CPU left, not from zero.
  check(world, [0, 1, 16], 64, 'retour coupe GPU')
})

test('an image that moves no page touches no set at all', () => {
  const world = scene()
  const { delta, sets, tracking } = world
  const ids = [0, 1, 2, 3, 4, 5, 16, 17, 18, 19]
  frame(world, ids, 64)
  const wantedBefore = queueOf(tracking.wanted)
  const listBefore = tracking.wanted.list
  // The pin step drains these; nothing else may add to them once the cut stops moving.
  const entering = sets.coverEntering.count,
    leaving = sets.coverLeaving.count
  for (let image = 0; image < 100; image++) {
    frame(world, ids, 64)
    assert.equal(delta.enteredCount, 0)
    assert.equal(delta.exitedCount, 0)
  }
  assert.equal(sets.coverEntering.count, entering)
  assert.equal(sets.coverLeaving.count, leaving)
  // Same backing array, same members, in the same places: nothing was rebuilt or reallocated.
  assert.equal(tracking.wanted.list, listBefore)
  assert.deepEqual(queueOf(tracking.wanted), wantedBefore)
})

test('the pin step hears of the root cover alone: its pages at open, then each holder that moves it', () => {
  const world = scene()
  const { sets, tracking, bootstrapKey, packed } = world
  const covered = [...keysOf(sets.coverEntering)]
  assert.deepEqual(
    new Set(covered),
    new Set(Array.from({ length: tracking.keyCount }, (_, k) => k).filter((k) => bootstrapKey[k])),
    'the cover at open',
  )
  sets.coverEntering.clear()
  // A cut that moves the queue, past the budget or not, tells the pins nothing.
  frame(world, [2, 4, 6, 8, 10, 12, 14], 3)
  frame(world, [2, 4, 6, 8, 10, 12], 3)
  assert.equal(sets.coverEntering.count + sets.coverLeaving.count, 0)
  // A cell's holder brings a page into the cover, then takes it away.
  const page = packed[14]
  sets.holdCover([page], true)
  assert.deepEqual([...keysOf(sets.coverEntering)], [tracking.keyOf(page)])
  sets.holdCover([page], false)
  assert.deepEqual(
    [sets.coverEntering.count, [...keysOf(sets.coverLeaving)]],
    [0, [tracking.keyOf(page)]],
  )
})
