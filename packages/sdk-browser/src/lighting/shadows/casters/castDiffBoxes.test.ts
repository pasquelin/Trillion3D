// What the diff names (`castDiff.ts`, `castDiffWgsl.ts` run in JavaScript): the boxes a placement leaves and enters, in the layer each is cached in.
import test from 'node:test'
import assert from 'node:assert/strict'
import { CAST_STATE_WORDS, CAST_VIEWS_WORD } from './castChanges.ts'
import {
  MOBILITY_CACHE_STATIC,
  MOBILITY_DEFORMS,
  MOBILITY_HIDDEN_SHADOW,
  MOBILITY_MOVING,
  MOBILITY_OFFSET_ALWAYS,
  MOBILITY_OFFSET_INVALIDATES,
  MOBILITY_SHADOWLESS,
} from '../mobilityBits.ts'
import { A, B, diffKernel } from './castDiffKernel.fixture.ts'

test('a memory made anew only remembers; a placement that did not change names nothing', () => {
  const kernel = diffKernel(2)
  kernel.place(0, A)
  kernel.place(1, B)
  assert.deepEqual(kernel.step(true).records, [], 'quiet: none named')
  assert.deepEqual(kernel.step().records, [], 'nothing changed: none')
})

test('a placement that arrives names its box, in the layer it is cached in', () => {
  const kernel = diffKernel(2)
  kernel.place(0, A)
  kernel.step(true)
  kernel.place(1, B, MOBILITY_MOVING)
  assert.deepEqual(kernel.step().records, [{ box: B, moving: true }])
  assert.deepEqual(kernel.step().records, [], 'once')
  kernel.place(1, null)
  // Its dynamic layer, where it stood; and the static layer over the places it passed (here that one), which the coarse pages keep its dynamic layer in.
  assert.deepEqual(
    kernel.step().records,
    [
      { box: B, moving: true },
      { box: B, moving: false },
    ],
    'and when it leaves',
  )
})

test('a placement that arrives where it was seen casting — a row seated on another mesh, the same box — names the box it leaves and the one it enters', () => {
  const kernel = diffKernel(2)
  kernel.place(0, A)
  kernel.place(1, B, MOBILITY_MOVING)
  kernel.step(true)
  assert.deepEqual(kernel.step().records, [], 'still: none')
  // Placement 0 is another primitive now, the same box: both of its ends are named, in the static layer.
  assert.deepEqual(kernel.step(false, [0]).records, [
    { box: A, moving: false },
    { box: A, moving: false },
  ])
  // Placement 1 left cached as dynamic and enters as a static one (a new primitive starts still): each end in its own layer, and the places the
  // moving primitive passed (here its box alone) staled in the static layer first, as the sweep of the primitive an arrival replaced.
  kernel.place(1, B, 0)
  assert.deepEqual(kernel.step(false, [1]).records, [
    { box: B, moving: false },
    { box: B, moving: true },
    { box: B, moving: false },
  ])
  assert.deepEqual(kernel.step().records, [], 'once')
})

test('a pinned placement that arrives where it was seen names its two boxes too, though its moves name none', () => {
  const kernel = diffKernel(1)
  kernel.place(0, A, MOBILITY_CACHE_STATIC)
  kernel.step(true)
  kernel.place(0, B, MOBILITY_CACHE_STATIC)
  assert.deepEqual(kernel.step().records, [], 'a pinned placement’s move names none')
  assert.deepEqual(kernel.step(false, [0]).records, [
    { box: B, moving: false },
    { box: B, moving: false },
  ])
})

test('a static placement’s first move stales the box it leaves in the static layer and the one it enters in the dynamic', () => {
  const kernel = diffKernel(1)
  kernel.place(0, A)
  kernel.step(true)
  kernel.place(0, B, MOBILITY_MOVING)
  assert.deepEqual(kernel.step().records, [
    { box: A, moving: false },
    { box: B, moving: true },
  ])
})

test('a moving placement’s moves stale the dynamic layer alone, at both ends', () => {
  const kernel = diffKernel(1)
  kernel.place(0, A, MOBILITY_MOVING)
  kernel.step(true)
  kernel.place(0, B, MOBILITY_MOVING)
  assert.deepEqual(kernel.step().records, [
    { box: A, moving: true },
    { box: B, moving: true },
  ])
})

test('a placement that deforms is cached as dynamic: its arrival and its moves stale the dynamic layer alone', () => {
  const kernel = diffKernel(2)
  kernel.place(0, A, MOBILITY_DEFORMS)
  kernel.step(true)
  kernel.place(1, B, MOBILITY_DEFORMS)
  assert.deepEqual(kernel.step().records, [{ box: B, moving: true }], 'it arrives')
  kernel.place(0, B, MOBILITY_DEFORMS)
  assert.deepEqual(
    kernel.step().records,
    [
      { box: A, moving: true },
      { box: B, moving: true },
    ],
    'it moves',
  )
  // It begins to move and settles, and stays dynamic: the static layer is never staled.
  kernel.place(0, B, MOBILITY_DEFORMS | MOBILITY_MOVING)
  assert.deepEqual(kernel.step().records, [{ box: B, moving: true }], 'it begins to move')
  kernel.place(0, B, MOBILITY_DEFORMS)
  assert.deepEqual(kernel.step().records, [{ box: B, moving: true }], 'it settles')
})

test('a placement that casts no shadow lists the box of its transition to dynamic, flagged for the stale to skip', () => {
  const kernel = diffKernel(1)
  kernel.place(0, A, MOBILITY_SHADOWLESS)
  kernel.step(true)
  kernel.state()
  kernel.place(0, A, MOBILITY_SHADOWLESS | MOBILITY_DEFORMS)
  kernel.step()
  kernel.state()
  assert.deepEqual(kernel.listedFacts(), [MOBILITY_SHADOWLESS])
})

test('a box carries the offset facts of its placement and the square of its distance, at both ends of a move', () => {
  const kernel = diffKernel(2)
  const wears = MOBILITY_OFFSET_INVALIDATES | MOBILITY_OFFSET_ALWAYS
  kernel.place(0, A)
  kernel.step(true)
  kernel.place(1, B, wears | MOBILITY_HIDDEN_SHADOW, 100)
  assert.deepEqual(kernel.step().facts, [{ offset: wears, disableSq: 100 }], 'it arrives')
  kernel.place(1, A, wears, 100)
  assert.deepEqual(
    kernel.step().facts,
    [
      { offset: wears, disableSq: 100 },
      { offset: wears, disableSq: 100 },
    ],
    'it moves',
  )
  kernel.place(0, B)
  assert.deepEqual(kernel.step().facts, [
    { offset: 0, disableSq: 0 },
    { offset: 0, disableSq: 0 },
  ])
})

test('a placement that settles stales the static layer under its box once, where it stands', () => {
  const kernel = diffKernel(1)
  kernel.place(0, A, MOBILITY_MOVING)
  kernel.step(true)
  kernel.place(0, A, 0)
  assert.deepEqual(kernel.step().records, [{ box: A, moving: false }])
  assert.deepEqual(kernel.step().records, [])
})

test('a placement that settles stales the static layer over every place it was cached as dynamic in, once', () => {
  const kernel = diffKernel(1)
  const C = [8, 0, 0, 10, 2, 2]
  kernel.place(0, A)
  kernel.step(true)
  kernel.place(0, B, MOBILITY_MOVING)
  kernel.step()
  kernel.place(0, C, MOBILITY_MOVING)
  kernel.step()
  kernel.place(0, C, 0)
  assert.deepEqual(
    kernel.step().records,
    [
      { box: C, moving: false },
      { box: [4, 0, 0, 10, 2, 2], moving: false },
    ],
    'where it stands, then the places it passed since it left the static layer',
  )
  assert.deepEqual(kernel.step().records, [], 'once')
  kernel.place(0, A, MOBILITY_MOVING)
  kernel.step()
  kernel.place(0, A, 0)
  assert.deepEqual(
    kernel.step().records,
    [{ box: A, moving: false }],
    'the next stop forgets the places of the last',
  )
})

test('a placement that stops or starts casting names its box, once', () => {
  const kernel = diffKernel(1)
  kernel.place(0, A)
  kernel.step(true)
  kernel.place(0, A, MOBILITY_SHADOWLESS)
  assert.deepEqual(kernel.step().records, [{ box: A, moving: false }], 'it stopped')
  kernel.place(0, B, MOBILITY_SHADOWLESS)
  assert.deepEqual(kernel.step().records, [], 'moved while it casts nothing: none')
  kernel.place(0, B, 0)
  assert.deepEqual(kernel.step().records, [{ box: B, moving: false }], 'it started')
  kernel.place(0, B, MOBILITY_HIDDEN_SHADOW)
  assert.deepEqual(kernel.step().records, [{ box: B, moving: false }], 'it casts while hidden now')
})

test('a placement that pins its shadows is followed without a record for its moves', () => {
  const kernel = diffKernel(1)
  kernel.place(0, A, MOBILITY_CACHE_STATIC)
  kernel.step(true)
  kernel.place(0, B, MOBILITY_CACHE_STATIC)
  assert.deepEqual(kernel.step().records, [])
  kernel.place(0, null, MOBILITY_CACHE_STATIC)
  assert.deepEqual(kernel.step().records, [{ box: B, moving: false }], 'it leaves, as any')
})

test('a box that stays within the one it leaves names both ends, as the previous bounds and the new', () => {
  const kernel = diffKernel(1)
  kernel.place(0, A)
  kernel.step(true)
  const inside = [0.5, 0.5, 0.5, 1.5, 1.5, 1.5]
  kernel.place(0, inside)
  // The reference invalidates the bounds a moved instance had and the ones it has, each in full;
  // no step skips the new box for the old one's holding it.
  assert.deepEqual(kernel.step().records, [
    { box: A, moving: false },
    { box: inside, moving: false },
  ])
})

test('a list too small flags its overflow, never loses the fact that boxes were named', () => {
  const kernel = diffKernel(3, 2)
  kernel.step(true)
  for (let r = 0; r < 3; r++) kernel.place(r, [r * 8, 0, 0, r * 8 + 2, 2, 2])
  const { records, overflow } = kernel.step()
  assert.equal(records.length, 2, 'the room it had')
  assert.equal(overflow, true)
})

// The cache state of a rank that arrives is zeroed by the CPU's signal (`arriveRank`, `mobilityState.ts`),
// told to the state per view as one array of the ranks, not inferred by the diff from a word that
// stopped saying it casts nothing.
test('the diff leaves the cache state of a rank in any view alone, whatever its word did', () => {
  const kernel = diffKernel(1)
  kernel.place(0, A, MOBILITY_SHADOWLESS)
  kernel.step(true)
  // What the placement that left the rank held: tracked and dynamic in two views (`CAST_VIEWS_WORD`).
  kernel.castState[CAST_VIEWS_WORD] = 0x00030003
  kernel.place(0, A)
  kernel.step()
  assert.equal(kernel.castState[CAST_VIEWS_WORD], 0x00030003, 'cast again after casting nothing')
})

test('a rank that arrived starts with no cache state in any view, the others keep theirs', () => {
  const kernel = diffKernel(2)
  kernel.place(0, A)
  kernel.place(1, B)
  kernel.step(true)
  // Both ranks held a placement cached as dynamic in the view, tracked; neither deforms now.
  for (const r of [0, 1]) kernel.castState[r * CAST_STATE_WORDS + CAST_VIEWS_WORD] = 0x00010001
  // A placement that stayed: its state turns to static (a transition). One that arrived: it held none,
  // so nothing turns.
  assert.deepEqual(
    kernel.state([1]).map((word) => word >>> 16),
    [1, 0],
    'rank 1 arrived',
  )
  // Told once: the next run, with no arrival, reads what the last run wrote.
  assert.deepEqual(
    kernel.state().map((word) => word >>> 16),
    [0, 0],
  )
  assert.equal(kernel.castState[CAST_VIEWS_WORD + CAST_STATE_WORDS], 1 << 16, 'tracked from now on')
})
