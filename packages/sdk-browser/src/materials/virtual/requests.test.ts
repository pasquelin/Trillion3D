// What a pass serves: fresh feedback in weight order, or what the previous pass deferred; fresh
// feedback replaces the backlog, since it names what the image looks at now.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createTileRequests, type TileWanted } from './requests.ts'
import { createTileCounters } from './counters.ts'

/** An atlas of `entries` streamed tiles, none resident, keyed by the feedback index it is given —
 *  a real page table subtracts its own offset first —, each served at `served` by its ancestor,
 *  the texture streaming levels 0 to 3 over 8 × 8, 4 × 4, 2 × 2 and 1 tiles. `at` places a tile of
 *  an index. */
const atlas = (
  entries: number,
  retired = false,
  served = 2,
  at: (index: number) => { level: number; tx: number; ty: number } = (index) => ({
    level: 0,
    tx: index,
    ty: 0,
  }),
) =>
  ({
    textures: [{}, { retired, layout: { tail: 4, across: [8, 4, 2, 1], down: [8, 4, 2, 1] } }],
    pages: {
      entries,
      tileOf(index: number, into: { slot: number; level: number; tx: number; ty: number }) {
        Object.assign(into, { slot: 1, ...at(index) })
        return into
      },
    },
    servedLevel: () => served,
    resides: () => false,
  }) as never

/** The tiles a feedback names: the ranks with a count, as the GPU lists them. */
const hits = (counts: number[]) => {
  const named = counts.flatMap((weight, index) => (weight ? [[index, weight]] : []))
  return {
    count: named.length,
    index: Uint32Array.from(named.map(([index]) => index)),
    weight: Uint32Array.from(named.map(([, weight]) => weight)),
  }
}

const served = (wanted: TileWanted) => wanted.list.slice(wanted.from, wanted.to)

function requests(feedback: Array<ReturnType<typeof hits> | undefined>, color: never = atlas(3)) {
  const counters = createTileCounters()
  return {
    counters,
    queue: createTileRequests({
      feedback: { take: () => feedback.shift() } as never,
      color,
      data: atlas(2),
      counters,
    }),
  }
}

test('fresh feedback is served heaviest first, across both atlases, and counted', () => {
  const { queue, counters } = requests([hits([1, 0, 3, 2, 0])])
  const wanted = queue.take(1)
  assert.deepEqual(
    served(wanted).map((r) => [r.weight, r.key.tx]),
    [
      [3, 2],
      [2, 3],
      [1, 0],
    ],
  )
  assert.equal(counters.requested, 3)
  assert.equal(counters.missingAverage, 2, 'each named tile is two levels coarser than asked')
})

test('a deferred remainder is offered again until fresh feedback replaces it', () => {
  const { queue } = requests([hits([1, 2, 3, 0, 0]), undefined, hits([0, 0, 0, 0, 9])])
  const first = queue.take(1)
  queue.defer(1)
  assert.equal(queue.deferred, 2)
  const second = queue.take(2)
  assert.equal(queue.frame, 1, 'a replay is placed at the frame of the feedback that named it')
  assert.deepEqual(
    served(second).map((r) => r.weight),
    [2, 1],
    'no feedback: the backlog, still in weight order',
  )
  queue.defer(first.to)
  assert.equal(queue.deferred, 0)
  queue.defer(0)
  assert.equal(queue.deferred, 3, 'a pass that served nothing defers all it was offered')
  const third = queue.take(3)
  assert.equal(queue.frame, 3)
  assert.deepEqual(
    served(third).map((r) => r.weight),
    [9],
    'fresh feedback wins over the backlog',
  )
  assert.equal(
    queue.deferred,
    1,
    'the backlog fresh feedback replaced is gone at once: the fresh tile alone is offered',
  )
})

test('feedback from an image before a drop never requests retired texture tiles', () => {
  const counters = createTileCounters()
  const queue = createTileRequests({
    feedback: { take: () => hits([9, 3]) } as never,
    color: atlas(1, true),
    data: atlas(1),
    counters,
  })
  assert.deepEqual(
    served(queue.take(1)).map((request) => request.weight),
    [3],
  )
  assert.equal(counters.requested, 1)
})

test('the requests are records reused from one feedback to the next', () => {
  const { queue } = requests([hits([5, 0, 1]), hits([0, 4, 0, 0, 2])])
  const first = served(queue.take(1)).slice()
  const second = served(queue.take(2))
  assert.deepEqual(
    second.map((request) => request.weight),
    [4, 2],
  )
  assert.ok(
    second.every((request) => first.includes(request)),
    'a shorter feedback is served from the records the longer one made',
  )
})

test('a tile is as urgent as the pixels that named it times one more than its level', () => {
  const placed = [
    { level: 0, tx: 0, ty: 0 },
    { level: 1, tx: 0, ty: 0 },
    { level: 2, tx: 0, ty: 0 },
  ]
  const { queue } = requests(
    [hits([5, 4, 2])],
    atlas(3, false, 2, (index) => placed[index]),
  )
  assert.deepEqual(
    served(queue.take(1)).map((r) => [r.key.level, r.weight]),
    [
      [1, 8],
      [2, 6],
      [0, 5],
    ],
    '5 pixels at level 0, 4 at level 1, 2 at level 2: 5, 8 and 6',
  )
})

test('a tile served three levels coarser or more also asks the tile two levels finer than that one', () => {
  const { queue, counters } = requests([hits([4])], atlas(1, false, 3))
  assert.deepEqual(
    served(queue.take(1)).map((r) => [r.key.level, r.key.tx, r.weight]),
    [
      [1, 0, 8],
      [0, 0, 4],
    ],
    'level 1 under the tile asked at 0, with its pixels: urgent by its level',
  )
  assert.equal(counters.requested, 1, 'the step is no pixel of the image')
  const near = requests([hits([4])], atlas(1, false, 2)).queue.take(1)
  assert.equal(served(near).length, 1, 'served two levels coarser: the tile asked alone')
})

test('a step toward a finer tile names the tile once, with the pixels of every tile stepping to it', () => {
  const placed = [
    { level: 0, tx: 0, ty: 0 },
    { level: 0, tx: 1, ty: 1 },
    { level: 0, tx: 4, ty: 0 },
  ]
  const { queue } = requests(
    [hits([2, 3, 4])],
    atlas(3, false, 3, (index) => placed[index]),
  )
  assert.deepEqual(
    served(queue.take(1)).map((r) => [r.key.level, r.key.tx, r.key.ty, r.weight]),
    [
      [1, 0, 0, 10],
      [1, 2, 0, 8],
      [0, 4, 0, 4],
      [0, 1, 1, 3],
      [0, 0, 0, 2],
    ],
    'level 1 tile (0, 0) steps from (0, 0) and (1, 1): 2 + 3 pixels, once',
  )
})

test('a step is the ancestor of the tile asked, at the level two under the one served', () => {
  const { queue } = requests(
    [hits([1])],
    atlas(1, false, 4, () => ({ level: 0, tx: 7, ty: 7 })),
  )
  assert.deepEqual(
    served(queue.take(1)).map((r) => [r.key.level, r.key.tx, r.key.ty]),
    [
      [2, 1, 1],
      [0, 7, 7],
    ],
  )
})
