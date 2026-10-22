// The rows of a blended caster, a cutout and a grown table carry the placement's moving word
// (`mobility.test.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MOBILITY_CORNER_SHIFT,
  MOBILITY_CUTOUT,
  MOBILITY_FAR_SHADOW,
  MOBILITY_MOVING,
} from '../mobilityBits.ts'
import { createShadowMobility } from './mobility.ts'

/** Rows that draw no corner: the words hold their flags alone. */
const none = () => 0

// A blended caster follows its placement like any caster: the VSM transmission atlas keeps a still
// one in the static slice.
test("a blended caster's row is moving as its placement is", () => {
  const mobility = createShadowMobility()
  mobility.ensure(2, 4, () => new Float64Array(16))
  mobility.move(1, new Float64Array(16).fill(1))
  mobility.writeRows(
    (row) => [0, 1, 0, 1][row],
    4,
    0,
    3,
    () => {},
    none,
    2,
  )
  assert.deepEqual([...mobility.rowWords], [0, 1, 0, 1])
})

// A cutout's row is filed with the casters drawn with the fragment test; a blended caster's
// never is, cutout or not — the transmittance pass reads the other list alone.
test("a cutout row's word carries the cutout bit, beside its moving bit", () => {
  const mobility = createShadowMobility()
  mobility.ensure(2, 5, () => new Float64Array(16))
  mobility.move(1, new Float64Array(16).fill(1))
  const cutouts = new Set([1, 2, 4])
  mobility.writeRows(
    (row) => [0, 0, 1, 1][row] ?? -1,
    5,
    0,
    4,
    () => {},
    none,
    4,
    (row) => cutouts.has(row),
  )
  const [MOVING, CUTOUT] = [MOBILITY_MOVING, MOBILITY_CUTOUT]
  assert.deepEqual([...mobility.rowWords], [0, CUTOUT, MOVING | CUTOUT, MOVING, 0])
  assert.ok(mobility.rowWords.some((word) => (word & CUTOUT) !== 0))
  // The cutouts rewritten opaque: none is left.
  mobility.writeRows(
    (row) => [0, 0, 1, 1][row] ?? -1,
    5,
    1,
    2,
    () => {},
    none,
    4,
  )
  assert.ok(mobility.rowWords.every((word) => (word & MOBILITY_CUTOUT) === 0))
})

// A placement that casts far shadows gives each of its rows the far-shadow bit, which a sun's
// far-shadow test reads (`vsmRenderFarFlags`).
test('a placement that casts far shadows gives its rows the far bit, written again when touched', () => {
  const mobility = createShadowMobility()
  mobility.ensure(2, 4, () => new Float64Array(16))
  let far = new Set([1])
  const placementOf = (row: number) => [0, 1, 0, 1][row]
  const pushed: number[][] = []
  /** The rows of the placements touched alone (an empty span), or every row from `to` on. */
  const write = (to: number) =>
    mobility.writeRows(
      placementOf,
      4,
      0,
      to,
      (first, count) => pushed.push([first, count]),
      () => 3,
      4,
      () => false,
      (rank) => (far.has(rank) ? MOBILITY_FAR_SHADOW : 0),
    )
  const corners = 3 << MOBILITY_CORNER_SHIFT
  write(3)
  assert.deepEqual(
    [...mobility.rowWords],
    [corners, corners + MOBILITY_FAR_SHADOW, corners, corners + MOBILITY_FAR_SHADOW],
  )
  far = new Set()
  mobility.touch(1)
  pushed.length = 0
  write(-1)
  assert.deepEqual([...mobility.rowWords], [corners, corners, corners, corners])
  assert.deepEqual(
    pushed,
    [
      [1, 1],
      [3, 1],
    ],
    'its two rows, one run each',
  )
  far = new Set([1])
  mobility.touch(1)
  write(-1)
  assert.equal(mobility.rowWords[3], corners + MOBILITY_FAR_SHADOW)
  mobility.touch(1)
  pushed.length = 0
  write(-1)
  assert.deepEqual(pushed, [], 'touched with nothing changed: the same words, none written')
})

// A table grown in place resizes the row words, never the placements' state: a placement
// that moved stays out of the static layer, and every row's word is written again.
test('a moving placement stays moving across a grow of the rows', () => {
  const mobility = createShadowMobility()
  mobility.ensure(2, 2, () => new Float64Array(16))
  mobility.move(1, new Float64Array(16).fill(1))
  mobility.writeRows(
    (row) => row,
    2,
    0,
    1,
    () => {},
    none,
  )
  mobility.ensure(2, 4, () => new Float64Array(16))
  assert.equal(mobility.moves(1), true)
  const pushed: Array<[number, number]> = []
  mobility.writeRows(
    (row) => [0, 1, 1, -1][row],
    4,
    3,
    3,
    (first, count) => pushed.push([first, count]),
    none,
  )
  assert.deepEqual(pushed, [[0, 4]], 'the whole grown table')
  assert.deepEqual([...mobility.rowWords], [0, MOBILITY_MOVING, MOBILITY_MOVING, 0])
})
