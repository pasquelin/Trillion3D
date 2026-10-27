// A written range of placement rows moves only what moved in it. The world hands each instance
// buffer's written span once (`session/world/poses/poses.ts`): a row of it left where it stands — a
// still mesh between two written ones, a sleeping wheel posed again in place — is no move. The
// follow declares no box, it only says which roots moved, flipped, or turned moving.
import test from 'node:test'
import assert from 'node:assert/strict'
import { boxTransform } from '../../../math/src/geometry/box.ts'
import { IDENTITY_MATRIX4 } from '../../../math/src/matrix/matrix4.ts'
import { createShadowMobility } from '../lighting/shadows/casters/mobility.ts'
import {
  createPlacementRows,
  placementWorld,
  seatDrawDistance,
  seatRootParent,
} from './rows/rows.ts'
import { followPlacementRows } from './update.ts'
import { worldVersion } from '../geometry/selection/rootWorld.ts'
import type { ClusterRoot } from '../geometry/selection/types.ts'
import { SHADOW_MAPLESS_ROOT, SHADOWLESS_ROOT } from '../visibility/shader/castingMark.ts'
import { castFlagsOf } from '../lighting/shadows/casters/castFlags.ts'
import { MOBILITY_SHADOWLESS } from '../lighting/shadows/mobilityBits.ts'

/** What a flip reads of the root it is handed: its mark, its distances and its parent. */
type Flipped = Pick<ClusterRoot<unknown>, 'mark' | 'drawDistance' | 'rootParent'>

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
    // `mark` and `parked` are what the flips write (`markCasting`, `settleRoot`).
    return {
      pages: [],
      world,
      worldAt: 0,
      localBox,
      worldBox,
      placement: { rows, index },
      mark: undefined as number | undefined,
      parked: false,
    }
  })
  const mobility = createShadowMobility()
  mobility.ensure(roots.length, (rank) => roots[rank].world.elements)
  const followed: number[] = [],
    distanced: number[] = [],
    versions: number[] = []
  const write = (moves: number[][], flip?: (rank: number, root: Flipped) => void) => {
    for (const [index, x] of moves) rows.matrices[index * 16 + 12] = x
    followed.length = 0
    distanced.length = 0
    versions.length = 0
    const last = BOXES.length - 1
    const follow = (rank: number, distant: boolean) => {
      followed.push(rank)
      // The world version the follower reads the root at.
      versions.push(worldVersion(roots[rank]))
      if (distant) distanced.push(rank)
    }
    return followPlacementRows(roots as never, rows, 0, last, flip, mobility.move, follow)
  }
  return { rows, roots, write, mobility, followed, distanced, versions }
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

test('a row seated on another mesh is another primitive: the follower hears it, and its placement arrives anew', () => {
  const { rows, roots, mobility } = placed()
  const [first, second, other] = [{}, {}, {}] as never[]
  const heard: number[] = []
  const follow = (rank: number, _distant: boolean, reseated: boolean) => {
    if (!reseated) return
    heard.push(rank)
    mobility.reseat(rank)
  }
  const follows = () =>
    followPlacementRows(roots as never, rows, 0, BOXES.length - 1, undefined, undefined, follow)
  const settle = () => {
    mobility.writeRoots(() => {}, { castFlags: () => 0 })
    mobility.clearArrivals()
  }
  rows.sources = [first, second, first]
  follows()
  assert.deepEqual(heard, [], 'the first follow seats the rows: no arrival')
  settle()
  assert.equal(mobility.hasArrivals(), false)
  rows.sources = [first, other, first]
  follows()
  assert.deepEqual(heard, [1], 'the row that is another mesh now')
  mobility.writeRoots(() => {}, { castFlags: () => 0 })
  assert.equal(mobility.hasArrivals(), true, 'its placement arrives')
  assert.deepEqual([...mobility.arrivals.subarray(0, 1)], [0b10], 'it alone')
})

test('a follower reads a root at the world it moved to: its box is taken after the move', () => {
  const { write, versions } = placed()
  write([[0, 0.1]])
  assert.deepEqual(versions, [1, 1, 1], 'the world is versioned before the follow')
  write([[0, 0.2]])
  assert.deepEqual(versions, [2, 2, 2])
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
  // `castShadow` and `castsShadowMaps` written on a world mesh reach its row (`poses/poseSeat.ts`);
  // its root leaves or enters every light cut, or only the shadow maps, and the pages it covered are
  // drawn again without it, or with it.
  const { rows, write, mobility } = placed(),
    marks: [number, number | undefined][] = []
  const flip = (rank: number, root: { mark?: number }) => marks.push([rank, root.mark])
  for (const casting of [
    SHADOWLESS_ROOT,
    0,
    SHADOW_MAPLESS_ROOT,
    SHADOWLESS_ROOT | SHADOW_MAPLESS_ROOT,
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

test("a row that leaves the shadow maps flips its root's mobility word, which the next write sends", () => {
  // The flip hears the mark change (`settleRoot`) and touches the placement, as `flipWorld` does: the word is written again
  // with the bit that makes the caster passes, and the box diff, skip it.
  const { rows, roots, write, mobility } = placed()
  const pushed: number[][] = []
  const send = () => {
    pushed.length = 0
    mobility.writeRoots((first, count) => pushed.push([first, count]), {
      castFlags: (rank) => castFlagsOf(roots[rank]),
    })
  }
  send()
  assert.deepEqual(
    [...mobility.words].map((word) => word & MOBILITY_SHADOWLESS),
    [0, 0, 0],
  )
  const flip = (rank: number) => mobility.touch(rank)
  rows.casting[1] = SHADOW_MAPLESS_ROOT
  assert.equal(write([], flip), true, 'the mark changed whatever the pose')
  send()
  assert.deepEqual(pushed, [[1, 1]], 'only the word that flipped is sent')
  assert.deepEqual(
    [...mobility.words].map((word) => word & MOBILITY_SHADOWLESS),
    [0, MOBILITY_SHADOWLESS, 0],
  )
  rows.casting[1] = 0
  write([], flip)
  send()
  assert.deepEqual([pushed, mobility.words[1] & MOBILITY_SHADOWLESS], [[[1, 1]], 0], 'and back')
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
  const { rows, write, mobility, distanced } = placed(),
    seen: [number, unknown][] = []
  const flip = (rank: number, root: { drawDistance?: unknown }) =>
    seen.push([rank, root.drawDistance])
  seatDrawDistance(rows, 1, { min: 2, max: 50, perInstance: false })
  assert.equal(write([], flip), true, 'a distance named: the root is flipped')
  assert.deepEqual(seen, [[1, { min: 2, max: 50, perInstance: false }]])
  assert.deepEqual(distanced, [1], 'its follow hears the distances changed')
  seen.length = 0
  assert.equal(write([], flip), false, 'written again unchanged: nothing')
  assert.deepEqual(distanced, [], 'unchanged distances: none heard')
  // A nearest alone is a distance of an object of its own: the root is flipped for it too.
  seatDrawDistance(rows, 1, { min: 4, max: 0, perInstance: false })
  assert.equal(write([], flip), true, 'a nearest alone')
  assert.deepEqual(seen, [[1, { min: 4, max: 0, perInstance: false }]])
  seen.length = 0
  seatDrawDistance(rows, 1, undefined)
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
