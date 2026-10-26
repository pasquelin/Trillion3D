// The word of a placement carries the facts its clusters are cast by: how it casts far, whether its
// transform pins its shadows, whether a deformation moves it; and a grown set of roots keeps the
// placements' moving state (`mobility.test.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MOBILITY_CACHE_STATIC,
  MOBILITY_DEFORMS,
  MOBILITY_FAR_SHADOW,
  MOBILITY_FAR_SKIPPED,
  MOBILITY_FAR_TESTED,
  MOBILITY_MOVING,
} from '../mobilityBits.ts'
import { createShadowMobility } from './mobility.ts'
import { castFlagsOf } from './castFlags.ts'
import { CACHE_STATIC_ROOT, nodeCasting } from '../../../visibility/shader/castingMark.ts'

// A placement that says the far-shadow test reaches it, or never does, gives its word one bit or
// the other, and a rewrite clears the one it no longer says.
test('a placement’s far-shadow test bits reach its word and are cleared when it stops saying them', () => {
  const mobility = createShadowMobility()
  mobility.ensure(1, () => new Float64Array(16))
  let said = MOBILITY_FAR_TESTED
  const write = () =>
    mobility.writeRoots(
      () => {},
      () => said,
    )
  write()
  assert.deepEqual([...mobility.words], [MOBILITY_FAR_TESTED])
  for (said of [MOBILITY_FAR_SKIPPED, 0]) {
    mobility.touch(0)
    write()
    assert.deepEqual([...mobility.words], [said], `${said}`)
  }
})

test('a placement that casts far shadows has the far bit, written again when touched', () => {
  const mobility = createShadowMobility()
  mobility.ensure(4, () => new Float64Array(16))
  let far = new Set([1, 3])
  const pushed: number[][] = []
  const write = () =>
    mobility.writeRoots(
      (first, count) => pushed.push([first, count]),
      (rank) => (far.has(rank) ? MOBILITY_FAR_SHADOW : 0),
    )
  write()
  assert.deepEqual([...mobility.words], [0, MOBILITY_FAR_SHADOW, 0, MOBILITY_FAR_SHADOW])
  far = new Set()
  mobility.touch(1)
  mobility.touch(3)
  pushed.length = 0
  write()
  assert.deepEqual([...mobility.words], [0, 0, 0, 0])
  assert.deepEqual(
    pushed,
    [
      [1, 1],
      [3, 1],
    ],
    'its two placements, one run each',
  )
  far = new Set([1, 2])
  mobility.touch(1)
  mobility.touch(2)
  pushed.length = 0
  write()
  assert.deepEqual(pushed, [[1, 2]], 'two neighbours, one run')
  mobility.touch(1)
  pushed.length = 0
  write()
  assert.deepEqual(pushed, [], 'touched with nothing changed: the same word, none written')
})

// The roots grown in place resize the words, never the placements' state: a placement that moved
// stays out of the static layer, and every word is written again.
test('a moving placement stays moving across a grow of the roots', () => {
  const mobility = createShadowMobility()
  mobility.ensure(2, () => new Float64Array(16))
  mobility.move(1, new Float64Array(16).fill(1))
  mobility.writeRoots(
    () => {},
    () => 0,
  )
  mobility.ensure(4, () => new Float64Array(16))
  assert.equal(mobility.moves(1), true)
  const pushed: Array<[number, number]> = []
  mobility.writeRoots(
    (first, count) => pushed.push([first, count]),
    () => 0,
  )
  assert.deepEqual(pushed, [[0, 4]], 'the whole grown set')
  assert.deepEqual([...mobility.words], [0, MOBILITY_MOVING, 0, 0])
})

// A node that says its transform never invalidates its shadow cache (`shadowCacheInvalidation`
// `'static'`) marks its root, whose word carries the bit and never counts as moving: its pose is not
// told to the static slice.
test('a placement that pins its shadows has the pin, and never the moving bit', () => {
  const node = { castShadow: true, shadowCacheInvalidation: 'static' }
  assert.equal(nodeCasting(node), CACHE_STATIC_ROOT)
  assert.equal(nodeCasting({ ...node, shadowCacheInvalidation: 'rigid' }), 0)
  const pinned = castFlagsOf({ mark: nodeCasting(node) })
  assert.ok(
    (pinned & MOBILITY_CACHE_STATIC) !== 0 &&
      (castFlagsOf({ mark: 0 }) & MOBILITY_CACHE_STATIC) === 0,
  )
  const mobility = createShadowMobility()
  mobility.ensure(2, () => new Float64Array(16))
  mobility.move(0, new Float64Array(16).fill(1))
  mobility.move(1, new Float64Array(16).fill(1))
  mobility.writeRoots(
    () => {},
    (rank) => (rank === 0 ? pinned : 0),
  )
  const pin = pinned & MOBILITY_CACHE_STATIC
  assert.deepEqual(
    [...mobility.words].map((word) => word & (MOBILITY_MOVING | pin)),
    [pin, MOBILITY_MOVING],
  )
})

// A placement a deformation moves says so: the pages its casters draw while it moves are marked
// dirty as they are drawn (`vsmRenderCandidateFlags`).
test('a deformed placement has the deforming bit, a plain one not', () => {
  assert.ok((castFlagsOf({ deformation: {} }) & MOBILITY_DEFORMS) !== 0)
  assert.equal(castFlagsOf({ mark: 0 }) & MOBILITY_DEFORMS, 0)
})
