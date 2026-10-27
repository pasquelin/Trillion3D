// The word of a placement carries the facts its clusters are cast by: whether it casts, whether its
// transform pins its shadows, whether a deformation moves it; and a grown set of roots keeps the
// placements' moving state (`mobility.test.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MOBILITY_CACHE_STATIC,
  MOBILITY_DEFORMS,
  MOBILITY_MOVING,
  MOBILITY_OFFSET_ALWAYS,
  MOBILITY_OFFSET_INVALIDATES,
  MOBILITY_OFTEN_MOVING,
  MOBILITY_SHADOWLESS,
} from '../mobilityBits.ts'
import { createShadowMobility } from './mobility.ts'
import { castFlagsOf } from './castFlags.ts'
import { CACHE_STATIC_ROOT, nodeCasting } from '../../../visibility/shader/castingMark.ts'
import { rootWordsTwin } from './rootWords.fixture.ts'

test('a placement that casts no shadow has the shadowless bit, written again when touched', () => {
  const mobility = createShadowMobility()
  mobility.ensure(4, () => new Float64Array(16))
  let shadowless = new Set([1, 3])
  const pushed: number[][] = []
  const write = () =>
    mobility.writeRoots((first, count) => pushed.push([first, count]), {
      castFlags: (rank) => (shadowless.has(rank) ? MOBILITY_SHADOWLESS : 0),
    })
  write()
  assert.deepEqual([...mobility.words], [0, MOBILITY_SHADOWLESS, 0, MOBILITY_SHADOWLESS])
  shadowless = new Set()
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
  shadowless = new Set([1, 2])
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
  mobility.writeRoots(() => {}, { castFlags: () => 0 })
  mobility.ensure(4, () => new Float64Array(16))
  assert.equal(mobility.moves(1), true)
  const pushed: Array<[number, number]> = []
  mobility.writeRoots((first, count) => pushed.push([first, count]), { castFlags: () => 0 })
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
  mobility.writeRoots(() => {}, { castFlags: (rank) => (rank === 0 ? pinned : 0) })
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

// A banked skinned instance that reads its rest pose this frame (under its screen size) deforms
// nothing: it is cached as static; once it animates, its word says it deforms.
test('a banked root at rest has no deforming bit, one that animates has it', () => {
  const root = { deformation: {} }
  assert.equal(castFlagsOf(root, undefined, true) & MOBILITY_DEFORMS, 0)
  assert.ok((castFlagsOf(root, undefined, false) & MOBILITY_DEFORMS) !== 0)
  assert.ok((castFlagsOf(root) & MOBILITY_DEFORMS) !== 0, 'one not banked always deforms')
  assert.equal(castFlagsOf({}, undefined, false) & MOBILITY_DEFORMS, 0)
})

// A surface that always evaluates its offset says so in the word, beside the bit that its offset may
// invalidate the placement's shadows (the layer of all its clusters).
test('a placement that wears an offset has the offset bits, the always bit only for a surface that always evaluates', () => {
  const evaluated = { evaluate: true, cache: 'auto', worn: true, always: false, bits: 0 } as const
  const wearing = castFlagsOf({}, evaluated)
  assert.ok((wearing & MOBILITY_OFFSET_INVALIDATES) !== 0)
  assert.equal(wearing & MOBILITY_OFFSET_ALWAYS, 0)
  const always = castFlagsOf({}, { ...evaluated, evaluate: false, always: true })
  assert.ok((always & (MOBILITY_OFFSET_INVALIDATES | MOBILITY_OFFSET_ALWAYS)) !== 0)
  assert.equal(
    castFlagsOf({}, { ...evaluated, cache: 'rigid' }) & MOBILITY_OFFSET_INVALIDATES,
    0,
    'an object that keeps its shadows from its offset',
  )
})

// The object's `mobility` marks its root; unset, a root a skin or a morph deforms is often moving
// and any other is not.
test('a placement is often moving when its object says movable, or when it deforms and says nothing else', () => {
  const often = (node: { mobility?: string }, root: object = {}) =>
    (castFlagsOf({ ...root, mark: nodeCasting({ castShadow: true, ...node }) }) &
      MOBILITY_OFTEN_MOVING) !==
    0
  assert.equal(often({}), false)
  assert.equal(often({ mobility: 'movable' }), true)
  assert.equal(often({ mobility: 'static' }), false)
  assert.equal(often({ mobility: 'stationary' }), false)
  assert.equal(often({}, { deformation: {} }), true)
  assert.equal(often({ mobility: 'movable' }, { deformation: {} }), true)
  assert.equal(often({ mobility: 'static' }, { deformation: {} }), false)
  assert.equal(often({ mobility: 'stationary' }, { deformation: {} }), false)
})

// A placement added that is often moving is cached as dynamic from its first image, as the reference
// marks a primitive added that is; one that never invalidates its shadows is not.
test('a new placement that is often moving starts moving, a new still one does not, a pinned one never', () => {
  const mobility = createShadowMobility()
  const words = new Map<number, number>([
    [0, MOBILITY_OFTEN_MOVING],
    [1, 0],
    [2, MOBILITY_OFTEN_MOVING | MOBILITY_CACHE_STATIC],
    [3, MOBILITY_OFFSET_INVALIDATES],
    [4, MOBILITY_OFTEN_MOVING | MOBILITY_SHADOWLESS],
  ])
  const write = () => mobility.writeRoots(() => {}, { castFlags: (rank) => words.get(rank) ?? 0 })
  const moving = (...ranks: number[]) => ranks.map((rank) => mobility.moves(rank))
  mobility.ensure(5, () => new Float64Array(16))
  write()
  assert.deepEqual(moving(0, 1, 2, 3, 4), [true, false, false, false, false])
  assert.ok((mobility.words[0] & MOBILITY_MOVING) !== 0, 'its word says it moves')
  assert.equal(mobility.words[2] & MOBILITY_MOVING, 0)
  // One that casts after casting nothing arrives as well.
  words.set(4, MOBILITY_OFTEN_MOVING)
  mobility.touch(4)
  write()
  assert.equal(mobility.moves(4), true)
  // Roots added later: the new ones arrive, the ones kept are as they were.
  words.set(5, MOBILITY_OFTEN_MOVING)
  words.set(6, 0)
  mobility.ensure(7, () => new Float64Array(16))
  for (let frame = 0; frame < 101; frame++) mobility.settle(100)
  assert.equal(mobility.moves(0), false, 'it settled to static after the frames without a move')
  write()
  assert.deepEqual(moving(0, 5, 6), [false, true, false], 'a kept one is not weighed again')
})

// The reference's `r.Shadow.CacheWPOPrimitives`: a primitive whose material wears an offset or a
// displacement is a mesh shape that is often moving, so it is cached as dynamic when added, unless
// the option caches such primitives; one pinned to its cached shadows never is.
test('a placement that wears an offset or a displacement is often moving, unless the primitives that wear one are cached', () => {
  const worn = { evaluate: true, cache: 'auto', worn: true, always: false }
  const flags = (offsets: object | undefined, wpoMoves: boolean) =>
    castFlagsOf({}, offsets as never, false, wpoMoves)
  assert.equal(flags(worn, false) & MOBILITY_OFTEN_MOVING, 0, 'by itself it says nothing')
  assert.ok((flags(worn, true) & MOBILITY_OFTEN_MOVING) !== 0)
  assert.ok((flags(worn, true) & MOBILITY_OFFSET_INVALIDATES) !== 0, 'its offset still invalidates')
  // Whatever its object says of its cache, the offset's decision is the placement's alone: an
  // object that pins its shadows never arrives moving.
  const pinned = castFlagsOf({ mark: CACHE_STATIC_ROOT }, worn as never, false, true)
  const arrives = (word: number) => {
    const mobility = createShadowMobility()
    mobility.ensure(1, () => new Float64Array(16))
    mobility.writeRoots(() => {}, { castFlags: () => word })
    return mobility.moves(0)
  }
  assert.deepEqual(
    [arrives(flags(worn, true)), arrives(flags(worn, false)), arrives(pinned)],
    [true, false, false],
  )
})

test('the words written by the upload make a placement that wears an offset or a displacement arrive moving, and the option turned makes every placement arrive anew', () => {
  const { rt, roots, upload, held } = rootWordsTwin(3)
  const rows = rt.vis.rootOffsets as { rowOf: (rank: number) => object | undefined }
  rows.rowOf = (rank) => (rank === 0 ? { evaluate: true, cache: 'auto', worn: true } : undefined)
  // A displacement that moves points: a magnitude over a height map (`pagesDisplacementReach`).
  const displacement = { magnitude: 2, center: 0.25, fade: null }
  roots[1].pages = [{ material: { displacement, displacementMap: {} } }]
  upload()
  const moving = () => [0, 1, 2].map((rank) => rt.lights.mobility.moves(rank))
  assert.deepEqual(moving(), [true, true, false], 'an offset and a displacement arrive moving')
  assert.ok((held()[0] & MOBILITY_MOVING) !== 0)
  // The option on: the primitives that wear one are cached, they arrive still.
  ;(rt.context as { shadowCacheWpoPrimitives?: boolean }).shadowCacheWpoPrimitives = true
  upload()
  assert.deepEqual(moving(), [false, false, false], 'every placement arrived anew')
  assert.equal(held()[0] & MOBILITY_MOVING, 0)
  ;(rt.context as { shadowCacheWpoPrimitives?: boolean }).shadowCacheWpoPrimitives = false
  upload()
  assert.deepEqual(moving(), [true, true, false])
})

// An arrival is told to the diff's memory, which holds no cache state of it in any view; so is the
// return of a placement parked between two writes.
test('every arrival is told once: a new placement, one that casts again, one that left and returned between two writes', () => {
  const mobility = createShadowMobility()
  mobility.ensure(2, () => new Float64Array(16))
  let cast = [0, MOBILITY_SHADOWLESS]
  const write = () => mobility.writeRoots(() => {}, { castFlags: (rank) => cast[rank]! })
  /** The ranks that arrived since the last call, which forgets them. */
  const arrived = () => {
    const ranks: number[] = []
    mobility.arrivals.forEach((word, at) => {
      for (let bit = 0; bit < 32; bit++) if (word & (1 << bit)) ranks.push(at * 32 + bit)
    })
    mobility.clearArrivals()
    return ranks
  }
  write()
  assert.deepEqual(arrived(), [0, 1], 'new in the layout')
  assert.deepEqual(arrived(), [], 'told once')
  // Rank 1 casts after casting nothing.
  cast = [0, 0]
  mobility.touch(1)
  write()
  assert.deepEqual(arrived(), [1])
  // Rank 0 is parked and taken back before the next write: its words say nothing of it.
  mobility.park(0)
  mobility.touch(0)
  write()
  assert.deepEqual(arrived(), [0], 'left and returned: an arrival all the same')
  // Parked and still parked: no arrival until it casts.
  cast = [MOBILITY_SHADOWLESS, 0]
  mobility.park(0)
  mobility.touch(0)
  write()
  assert.deepEqual(arrived(), [])
  cast = [0, 0]
  mobility.touch(0)
  write()
  assert.deepEqual(arrived(), [0])
})

test('an updated placement is cached as dynamic from now on, unless its object pins its shadows', () => {
  const mobility = createShadowMobility()
  mobility.ensure(2, () => new Float64Array(16))
  mobility.writeRoots(() => {}, { castFlags: (rank) => (rank ? MOBILITY_CACHE_STATIC : 0) })
  assert.deepEqual([mobility.invalidate(0), mobility.moves(0)], [true, true])
  assert.deepEqual([mobility.invalidate(0), mobility.moves(0)], [false, true], 'already dynamic')
  assert.deepEqual([mobility.invalidate(1), mobility.moves(1)], [false, false], 'pinned')
  assert.equal(mobility.invalidate(9), false, 'no such placement')
})
