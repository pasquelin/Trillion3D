// A written range of placement rows moves only what moved in it. The world hands each instance
// buffer's written span once (`session/world/poses/poses.ts`): a row of it left where it stands — a
// still mesh between two written ones, a sleeping wheel posed again in place — is no move. The
// shadow pages a moved root left and entered are its rows' to stale on the GPU (`rows/rowCastWgsl.ts`):
// the follow declares no box, it only says which roots moved, flipped, or turned moving.
import test from 'node:test'
import assert from 'node:assert/strict'
import { boxTransform } from '../../../math/src/geometry/box.ts'
import { IDENTITY_MATRIX4 } from '../../../math/src/matrix/matrix4.ts'
import { createShadowMobility } from '../lighting/shadows/casters/mobility.ts'
import { createPlacementRows, placementWorld, seatRootParent } from './rows/rows.ts'
import { followPlacementRows } from './update.ts'
import { FAR_SHADOW_ROOT, SHADOWLESS_ROOT } from '../visibility/shader/castingMark.ts'

/** A small caster, the ground under it, a box far off: local boxes, placed at the origin. */
const BOXES = [
  [-0.1, 0, -0.1, 0.1, 0.2, 0.1],
  [-5, -0.1, -5, 5, 0, 5],
  [20, 0, 20, 21, 1, 21],
]

/** The three placements, rows of one buffer; the writer moves rows along x and hands the whole
 *  span as written, each root that reads a written row to `follow`. */
function placed() {
  const rows = createPlacementRows(BOXES.length)
  const roots = BOXES.map((local, index) => {
    rows.matrices.set(IDENTITY_MATRIX4, index * 16)
    rows.live[index] = 1
    const world = placementWorld(rows, index),
      worldBox = new Float64Array(6),
      localBox = Float64Array.from(local)
    boxTransform(worldBox, 0, localBox, 0, world.elements)
    return { pages: [], world, localBox, worldBox, placement: { rows, index } }
  })
  const mobility = createShadowMobility()
  mobility.ensure(roots.length, 1, (rank) => roots[rank].world.elements)
  const followed: number[] = []
  const write = (moves: number[][], flip?: (rank: number, root: { mark?: number }) => void) => {
    for (const [index, x] of moves) rows.matrices[index * 16 + 12] = x
    followed.length = 0
    const last = BOXES.length - 1
    return followPlacementRows(roots as never, rows, 0, last, flip, mobility.move, (rank) =>
      followed.push(rank),
    )
  }
  return { rows, write, mobility, followed }
}

test('a written range moves each root that moved, and none left where it stands', () => {
  const { write, mobility, followed } = placed()
  assert.equal(
    write([
      [0, 0.1],
      [2, 1],
    ]),
    true,
  )
  assert.deepEqual([0, 1, 2].map(mobility.moves), [true, false, true])
  assert.deepEqual(followed, [0, 1, 2], 'every root of the written span is followed')
  assert.equal(write([[0, 0.1]]), false, 'written again where it stands: no move')
})

test('a row parked or taken back where it stands is drawn again, and is no move', () => {
  // A hidden or shown primitive is removed or added and its pages invalidated once; only a
  // transform update caches it as dynamic: the static layer keeps it.
  const { rows, write, mobility } = placed()
  rows.live[2] = 0
  assert.equal(write([]), true, 'parked: drawn again')
  rows.live[2] = 1
  assert.equal(write([]), true, 'taken back: drawn again')
  assert.equal(mobility.moves(2), false, 'shown or hidden in place: never moving')
})

test('a row that changes how it casts flips its mark, whatever its pose', () => {
  // `castShadow` and `castFarShadow` written on a world mesh reach its row (`poses/poseSeat.ts`);
  // its root leaves or enters every light cut, or keeps or loses the far bit the shadow raster's
  // rows read, and the pages it covered are drawn again without it, or with it.
  const { rows, write, mobility } = placed(),
    marks: [number, number | undefined][] = []
  const flip = (rank: number, root: { mark?: number }) => marks.push([rank, root.mark])
  for (const casting of [
    SHADOWLESS_ROOT,
    0,
    FAR_SHADOW_ROOT,
    SHADOWLESS_ROOT | FAR_SHADOW_ROOT,
    0,
  ]) {
    rows.casting[1] = casting
    assert.equal(write([], flip), true, 'a change of casting, whatever its pose')
    assert.deepEqual(marks, [[1, casting || undefined]], 'each bit is its own')
    assert.equal(mobility.moves(1), false, 'the root never made moving')
    marks.length = 0
    assert.equal(write([], flip), false, 'written again unchanged: nothing')
  }
})

test('a moving row that stops casting as it moves stays moving', () => {
  // The static layer leaves a moving placement out (`mobility.ts`), so it has nothing of it.
  const { rows, write, mobility } = placed()
  write([[0, 0.1]])
  rows.casting[0] = SHADOWLESS_ROOT
  assert.equal(write([[0, 0.2]]), true)
  assert.equal(mobility.moves(0), true)
})

test('a row that names other draw distances hands its root the distances it names now', () => {
  // Rows are seated before their cells stream in: the distances come with the cell, or change at
  // run time, and reach the cut through the flip (`GpuSelection.drawDistanceWorld`).
  const { rows, write, mobility } = placed(),
    seen: [number, unknown][] = []
  const flip = (rank: number, root: { drawDistance?: unknown }) =>
    seen.push([rank, root.drawDistance])
  rows.drawDistance = new Float32Array(2 * BOXES.length)
  rows.drawDistance.set([2, 50], 2)
  assert.equal(write([], flip), true, 'a distance named: the root is flipped')
  assert.deepEqual(seen, [[1, { min: 2, max: 50 }]])
  seen.length = 0
  assert.equal(write([], flip), false, 'written again unchanged: nothing')
  rows.drawDistance.set([0, 0], 2)
  assert.equal(write([], flip), true, 'the distance taken back')
  assert.deepEqual(seen, [[1, undefined]])
  assert.equal(mobility.moves(1), false, 'no distance makes a root move')
})

test('a row that names the group above its root hands its root the parent it names now', () => {
  // Rows are seated before their cells stream in: an instance of an assembly comes with its cell,
  // and reaches the cut through the flip (`GpuSelection.rootParentWorld`).
  const { rows, write, mobility } = placed(),
    seen: [number, unknown][] = []
  const flip = (rank: number, root: { rootParent?: unknown }) => seen.push([rank, root.rootParent])
  const parent = { error: 6.5, sphere: [1.25, -2, 3, 40] as const }
  seatRootParent(rows, 1, parent)
  assert.equal(write([], flip), true, 'a parent named: the root is flipped')
  assert.deepEqual(seen, [[1, parent]])
  seen.length = 0
  assert.equal(write([], flip), false, 'written again unchanged: nothing')
  seatRootParent(rows, 1, undefined)
  assert.equal(write([], flip), true, 'the parent taken back')
  assert.deepEqual(seen, [[1, undefined]])
  assert.equal(mobility.moves(1), false, 'no parent makes a root move')
  // An exact group has an error of 0 and is a parent all the same: its ball names it.
  const exact = { error: 0, sphere: [0, 0, 0, 5] as const }
  seatRootParent(rows, 1, exact)
  seen.length = 0
  assert.equal(write([], flip), true)
  assert.deepEqual(seen, [[1, exact]])
})
