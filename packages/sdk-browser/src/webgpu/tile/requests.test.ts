// What a pass serves: fresh feedback in weight order, or what the previous pass deferred; fresh
// feedback replaces the backlog, since it names what the image looks at now.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createTileRequests, type TileWanted } from './requests.ts'
import { createTileCounters } from './counters.ts'

/** An atlas of `entries` streamed tiles, none resident, keyed by the feedback index it is given —
 *  a real page table subtracts its own offset first. */
const atlas = (entries: number, retired = false) =>
  ({
    textures: [{}, { retired }],
    pages: {
      entries,
      tileOf(index: number, into: { slot: number; level: number; tx: number; ty: number }) {
        Object.assign(into, { slot: 1, level: 0, tx: index, ty: 0 })
        return into
      },
    },
    servedLevel: () => 2,
    touch: () => false,
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

function requests(feedback: Array<ReturnType<typeof hits> | undefined>) {
  const counters = createTileCounters()
  return {
    counters,
    queue: createTileRequests({
      feedback: { take: () => feedback.shift() } as never,
      color: atlas(3),
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
