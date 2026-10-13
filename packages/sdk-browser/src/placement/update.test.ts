// A written range of placement rows moves only what moved in it. The world hands each instance
// buffer's written span once (`world/core/worldPoses.ts`): a row of it left where it stands — a
// still mesh between two written ones, a sleeping wheel posed again in place — is no move. The
// shadow pages a moved root left and entered are its rows' to stale on the GPU (`rowCastWgsl.ts`):
// the follow declares no box, it only says which roots moved, flipped, or turned moving.
import test from 'node:test'
import assert from 'node:assert/strict'
import { boxTransform } from '../../../sdk-core/src/index.ts'
import { IDENTITY_MATRIX4 } from '../../../math/src/matrix/matrix4.ts'
import { createShadowMobility } from '../webgpu/shadow/mobility.ts'
import { createPlacementRows, placementWorld } from './rows.ts'
import { followPlacementRows } from './update.ts'
import { SHADOWLESS_ROOT } from '../visibility/shader/shadowlessRoot.ts'

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

test('a row that stops or starts casting flips its mark, whatever its pose', () => {
  // `castShadow` written on a world mesh reaches its row (`worldPoses.ts`); its root leaves
  // or enters every light cut, and the pages it covered are drawn again without it, or with it.
  const { rows, write, mobility } = placed(),
    marks: [number, number | undefined][] = []
  const flip = (rank: number, root: { mark?: number }) => marks.push([rank, root.mark])
  for (const shadowless of [1, 0]) {
    rows.shadowless[1] = shadowless
    assert.equal(write([], flip), true, 'a change of casting, whatever its pose')
    assert.deepEqual(marks, [[1, shadowless ? SHADOWLESS_ROOT : undefined]])
    assert.equal(mobility.moves(1), false, 'the root never made moving')
    marks.length = 0
    assert.equal(write([], flip), false, 'written again unchanged: nothing')
  }
})

test('a moving row that stops casting as it moves stays moving', () => {
  // The static layer leaves a moving placement out (`mobility.ts`), so it has nothing of it.
  const { rows, write, mobility } = placed()
  write([[0, 0.1]])
  rows.shadowless[0] = 1
  assert.equal(write([[0, 0.2]]), true)
  assert.equal(mobility.moves(0), true)
})
