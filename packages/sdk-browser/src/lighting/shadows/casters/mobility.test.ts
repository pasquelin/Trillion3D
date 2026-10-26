// A placement turns moving at its first move; its word carries the bit the page cull splits a
// page's casters by, and the words of the placements whose mobility or casting changed are
// rewritten, them alone.
import test from 'node:test'
import assert from 'node:assert/strict'
import { MOBILITY_MOVING, MOBILITY_SHADOWLESS } from '../mobilityBits.ts'
import { createShadowMobility } from './mobility.ts'
import { MOVE_MOVING, MOVE_NONE, MOVE_PROMOTED } from '../../../placement/update.ts'
import { createShadowResidence } from './residence.ts'
import { pageResidency } from '../../../geometry/dag/readiness.fixture.ts'

/** Placements that say nothing of how they cast: the words hold their mobility alone. */
const none = () => 0

test('the first move promotes a placement and opens the static layer; its later moves do not', () => {
  const mobility = createShadowMobility()
  const origin = new Float64Array(16)
  mobility.ensure(3, () => origin)
  assert.equal(mobility.moves(1), false)
  assert.equal(mobility.move(1, origin, true), MOVE_PROMOTED)
  assert.equal(mobility.moves(1), true)
  assert.equal(
    mobility.move(1, origin, true),
    MOVE_MOVING,
    'already moving: only its moving casters stale',
  )
  const pushed: number[][] = []
  const push = (first: number, count: number) => pushed.push([first, count])
  mobility.writeRoots(push, none)
  assert.deepEqual(pushed, [[0, 3]], 'a new layout: every word once')
  assert.deepEqual([...mobility.words], [0, MOBILITY_MOVING, 0])
  pushed.length = 0
  mobility.move(2, origin, true)
  mobility.writeRoots(push, none)
  assert.deepEqual(pushed, [[2, 1]], "a promotion rewrites its placement's word alone")
  assert.deepEqual([...mobility.words], [0, MOBILITY_MOVING, MOBILITY_MOVING])
})

// A placement at rest past the threshold turns static, and only its word is written again — the
// touched placements, not the whole table.
test('a placement that settles rewrites its word alone', () => {
  const mobility = createShadowMobility()
  const origin = new Float64Array(16)
  mobility.ensure(4, () => origin)
  mobility.writeRoots(() => {}, none)
  mobility.move(1, origin, true)
  mobility.move(2, origin, true)
  mobility.move(3, origin, true)
  mobility.writeRoots(() => {}, none)
  assert.deepEqual([...mobility.words], [0, 1, 1, 1])
  for (let frame = 0; frame < 3; frame++) {
    mobility.move(2, origin, true)
    mobility.settle(1)
  }
  assert.deepEqual(
    [1, 2, 3].filter((rank) => !mobility.moves(rank)),
    [1, 3],
    'the resting ones only',
  )
  const pushed: number[][] = []
  mobility.writeRoots((first, count) => pushed.push([first, count]), none)
  assert.deepEqual(
    pushed,
    [
      [1, 1],
      [3, 1],
    ],
    'their two words, apart',
  )
  assert.deepEqual([...mobility.words], [0, 0, 1, 0])
})

// A placement that casts no shadow — `castShadow = false`, hidden, parked — carries
// the shadowless bit in its word, rewritten when it flips.
test('a placement touched as shadowless marks its word, and clears it when it casts again', () => {
  const mobility = createShadowMobility()
  mobility.ensure(2, () => new Float64Array(16))
  let off = false
  const write = () =>
    mobility.writeRoots(
      () => {},
      (rank) => (off && rank === 1 ? MOBILITY_SHADOWLESS : 0),
    )
  write()
  assert.deepEqual([...mobility.words], [0, 0])
  off = true
  mobility.touch(1)
  write()
  assert.deepEqual([...mobility.words], [0, MOBILITY_SHADOWLESS])
  off = false
  mobility.touch(1)
  write()
  assert.deepEqual([...mobility.words], [0, 0])
})

// A write that leaves a placement where it stands — a pose copied again — opens no static layer; a
// row taken or parked, or a new pose, does.
test('a placement posed where it already stands does not move', () => {
  const mobility = createShadowMobility()
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  mobility.ensure(2, () => identity)
  mobility.move(0, identity)
  assert.equal(mobility.moves(0), false, 'same pose: still')
  mobility.move(0, identity, true)
  assert.equal(mobility.moves(0), true, 'taken or parked: moved')
  assert.equal(mobility.move(0, identity), MOVE_NONE, 'posed again where it was taken: no move')
  const shifted = identity.slice()
  shifted[12] = 1
  mobility.move(1, shifted)
  mobility.writeRoots(() => {}, none)
  assert.deepEqual([...mobility.words], [MOBILITY_MOVING, MOBILITY_MOVING], 'a new pose: moved')
})

test('a residency flag that drops and rises between two plans is no change for the shadows', () => {
  const residence = createShadowResidence()
  const flags = new Uint32Array(4),
    changed: number[] = []
  const flush = () => residence.flush(pageResidency(flags), (page) => changed.push(page))
  flags[2] = 1
  residence.noteRow(2)
  flush()
  assert.deepEqual(changed, [2], 'a page that arrived')
  // A cluster rewrite: the flag drops, then rises again before the next plan reads it.
  residence.noteRow(2)
  residence.noteRow(2)
  flush()
  assert.deepEqual(changed, [2], 'nothing new: the light cuts see the same page')
  flags[2] = 0
  residence.noteRow(2)
  flush()
  assert.deepEqual(changed, [2, 2], 'a page that left')
})
