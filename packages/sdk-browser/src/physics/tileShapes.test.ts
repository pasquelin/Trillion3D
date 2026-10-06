import test from 'node:test'
import assert from 'node:assert/strict'
import type { PhysicsBudget } from '../../../sdk-core/src/physics/index.ts'
import { recorded, repeated, residentAt, settle } from './tileShapes.fixture.ts'
import { landed, streamedModel } from './tiles.fixture.ts'

/** `repeated(count)` opened by a tile streamer within `budget` (twice `count` bodies), what its
 *  writer writes recorded, and the reads of the tile's object. */
async function streamed(count: number, budget: Partial<PhysicsBudget> = {}) {
  const streamer = await streamedModel(repeated(count), new Uint8Array(1), {
    ...{ bodies: 2 * count, ...budget },
  })
  const reads = () => streamer.fetched.filter((name) => name === 't0.bin').length
  return { ...streamer, ...recorded(streamer.writer), reads }
}

test('a tile a model places 1,000 times within range is read once and restored once', async () => {
  const streamer = await streamed(1000)
  await settle(streamer, [0, 0, 0], 1e5)
  const { bodies, errors, restored, reads } = streamer
  assert.deepEqual([reads(), restored.length, bodies.count.bodies, errors], [1, 1, 1000, []])
})

test('the bodies of a tile all reference its one shape, released once its last body leaves, never before', async () => {
  const streamer = await streamed(100)
  const { tiles, bodies, restored, released, builtOn } = streamer
  await settle(streamer, [0, 0, 0], 1e5)
  assert.deepEqual([builtOn.length, new Set(builtOn)], [100, new Set(restored)])
  // The range shrinking: the farther placements leave, the shape stays while one body is left.
  for (const [range, left] of [
    [300, 46],
    [50, 8],
    [0, 1],
  ]) {
    tiles.update([0, 0, 0], range)
    assert.deepEqual([bodies.count.bodies, released], [left, []], `within ${range} m`)
  }
  tiles.update([-1e5, 0, 0], 10)
  assert.deepEqual(released, restored, 'released with the last body')
  assert.deepEqual([bodies.count.bodies, bodies.count.collisionBytes], [0, 0])
})

test('the collision share counts a shared tile once and each placement one body: the farther wait for a body', async () => {
  // A share of 2 bytes, the tile's alone, and 600 bodies for 1,000 placements.
  const streamer = await streamed(1000, { memoryBytes: 4, bodies: 600 })
  const { bodies, errors, restored, reads } = streamer
  await settle(streamer, [0, 0, 0], 1e5)
  assert.deepEqual([bodies.count.collisionBytes, bodies.count.bodies, errors], [2, 600, []])
  assert.equal(Math.max(...residentAt(bodies, 600)), 5990, 'the 600 nearest')
  // Nearer the other end: each body that leaves makes room for one that waited, on the shape held.
  await settle(streamer, [10_000, 0, 0], 1e5)
  assert.deepEqual([bodies.count.bodies, restored.length, reads(), errors], [600, 1, 1, []])
  assert.equal(Math.min(...residentAt(bodies, 600)), 4000, 'the 600 nearest the other end')
})

test('a placement coming within range while its tile is resident gets its body with no read', async () => {
  const streamer = await streamed(2)
  const { tiles, bodies, restored, reads } = streamer
  // The first placement in, within 5 m of the eye; the second, 10 m away, out.
  await settle(streamer, [0, 0, 0], 5)
  assert.deepEqual([bodies.count.bodies, reads()], [1, 1])
  // Between the two, 4 m from each: the second's body comes in the update itself.
  tiles.update([6, 0, 0], 5)
  assert.equal(bodies.count.bodies, 2)
  await landed()
  assert.deepEqual([reads(), restored.length], [1, 1])
})

test('an update builds a bounded number of tile bodies, nearest first: a thousand come in over updates', async () => {
  const streamer = await streamed(1000)
  const { tiles, bodies } = streamer
  tiles.update([0, 0, 0], 1e5)
  await landed()
  tiles.update([0, 0, 0], 1e5)
  const first = bodies.count.bodies
  assert.ok(first > 0 && first < 1000, `${first} bodies in one update`)
  assert.equal(Math.max(...residentAt(bodies, 2000)), (first - 1) * 10, 'the nearest')
  const built = (await settle(streamer, [0, 0, 0], 1e5)).filter((added) => added > 0)
  assert.ok(
    built.every((added, i) => added === first || i === built.length - 1),
    `${built}`,
  )
  assert.equal(bodies.count.bodies, 1000)
})
