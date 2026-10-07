// A placement turns moving at its first move; its rows carry the word the page cull splits a
// page's casters by, and the rows of a placement whose mobility changed are rewritten, them alone.
import test from 'node:test'
import assert from 'node:assert/strict'
import { MOBILITY_SHADOWLESS } from '../../gpu/shadow/mobilityBits.ts'
import { createShadowMobility } from './mobility.ts'
import { MOVE_MOVING, MOVE_NONE, MOVE_PROMOTED } from '../../placement/update.ts'
import { createShadowResidence } from './residence.ts'

/** Rows that draw no corner: the words hold their flags alone. */
const none = () => 0

test('the first move promotes a placement and opens the static layer; its later moves do not', () => {
  const mobility = createShadowMobility()
  const origin = new Float64Array(16)
  mobility.ensure(3, 5, () => origin)
  assert.equal(mobility.moves(1), false)
  assert.equal(mobility.move(1, origin, true), MOVE_PROMOTED)
  assert.equal(mobility.moves(1), true)
  assert.equal(
    mobility.move(1, origin, true),
    MOVE_MOVING,
    'already moving: only its moving casters stale',
  )
  const pushed: number[][] = []
  const placementOf = (row: number) => [0, 1, 1, 2, -1][row]
  mobility.writeRows(placementOf, 5, 2, 2, (first, count) => pushed.push([first, count]), none)
  assert.deepEqual(pushed, [[0, 5]], 'a new table: every row once')
  assert.deepEqual([...mobility.rowWords], [0, 1, 1, 0, 0])
  mobility.writeRows(placementOf, 5, 3, 4, (first, count) => pushed.push([first, count]), none)
  assert.deepEqual(pushed[1], [3, 2], 'then the rows the table rewrote')
  pushed.length = 0
  mobility.move(2, origin, true)
  mobility.writeRows(placementOf, 5, 0, -1, (first, count) => pushed.push([first, count]), none)
  assert.deepEqual(pushed, [[3, 1]], "a promotion rewrites its placement's rows alone")
  assert.deepEqual([...mobility.rowWords], [0, 1, 1, 1, 0])
})

// A placement at rest past the threshold turns static, and only its rows are written again — the
// dirty primitives, not the whole table.
test('a placement that settles rewrites its rows alone', () => {
  const mobility = createShadowMobility()
  const origin = new Float64Array(16)
  mobility.ensure(3, 4, () => origin)
  const placementOf = (row: number) => [0, 1, 2, 1][row]
  mobility.writeRows(placementOf, 4, 0, 3, () => {}, none)
  mobility.move(1, origin, true)
  mobility.move(2, origin, true)
  mobility.writeRows(placementOf, 4, 0, -1, () => {}, none)
  assert.deepEqual([...mobility.rowWords], [0, 1, 1, 1])
  const turned: number[] = []
  for (let frame = 0; frame < 3; frame++) {
    mobility.move(2, origin, true)
    mobility.settle(1, (rank) => turned.push(rank))
  }
  assert.deepEqual(turned, [1], 'the resting one only')
  const pushed: number[][] = []
  mobility.writeRows(placementOf, 4, 0, -1, (first, count) => pushed.push([first, count]), none)
  assert.deepEqual(
    pushed,
    [
      [1, 1],
      [3, 1],
    ],
    'its two rows, apart',
  )
  assert.deepEqual([...mobility.rowWords], [0, 0, 1, 0])
})

// A placement that casts no shadow — `castShadow = false`, hidden, parked — carries
// the shadowless bit on its rows, rewritten when it flips.
test('a placement touched as shadowless marks its rows, and clears them when it casts again', () => {
  const mobility = createShadowMobility()
  mobility.ensure(2, 3, () => new Float64Array(16))
  const placementOf = (row: number) => [0, 1, 1][row]
  let off = false
  const write = () =>
    mobility.writeRows(
      placementOf,
      3,
      0,
      -1,
      () => {},
      none,
      3,
      undefined,
      (rank) => off && rank === 1,
    )
  write()
  assert.deepEqual([...mobility.rowWords], [0, 0, 0])
  off = true
  mobility.touch(1)
  write()
  assert.deepEqual([...mobility.rowWords], [0, MOBILITY_SHADOWLESS, MOBILITY_SHADOWLESS])
  off = false
  mobility.touch(1)
  write()
  assert.deepEqual([...mobility.rowWords], [0, 0, 0])
})

// A write that leaves a placement where it stands — a pose copied again, a row inside a written
// range — opens no static layer; a row taken or parked, or a new pose, does.
test('a placement posed where it already stands does not move', () => {
  const mobility = createShadowMobility()
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  mobility.ensure(2, 2, () => identity)
  mobility.move(0, identity)
  assert.equal(mobility.moves(0), false, 'same pose: still')
  mobility.move(0, identity, true)
  assert.equal(mobility.moves(0), true, 'taken or parked: moved')
  assert.equal(mobility.move(0, identity), MOVE_NONE, 'posed again where it was taken: no move')
  const shifted = identity.slice()
  shifted[12] = 1
  mobility.move(1, shifted)
  assert.deepEqual([...mobility.rowWords], [0, 0])
  const pushed: number[] = []
  mobility.writeRows(
    (row) => row,
    2,
    0,
    1,
    () => pushed.push(0),
    none,
  )
  assert.deepEqual([...mobility.rowWords], [1, 1], 'a new pose: moved')
})

test('a residency flag that drops and rises between two plans is no change for the shadows', () => {
  const residence = createShadowResidence()
  const flags = new Uint32Array(4),
    changed: number[] = []
  const flush = () => residence.flush(flags, (page) => changed.push(page))
  flags[2] = 1
  residence.noteRow(2, 4)
  flush()
  assert.deepEqual(changed, [2], 'a page that arrived')
  // A row rewrite: the flag drops, then rises again before the next plan reads it.
  residence.noteRow(2, 4)
  residence.noteRow(2, 4)
  flush()
  assert.deepEqual(changed, [2], 'nothing new: the light cuts see the same page')
  flags[2] = 0
  residence.noteRow(2, 4)
  flush()
  assert.deepEqual(changed, [2, 2], 'a page that left')
})
