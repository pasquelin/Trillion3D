import test from 'node:test'
import assert from 'node:assert/strict'
import type { PhysicsBudget } from '../../../sdk-core/src/physics/index.ts'
import { cooked, landed, streamedModel, tile } from './tiles.fixture.ts'

/** A model placing one two-byte tile `count` times, ten metres apart along x from the origin: the
 *  `i`-th spans x `10 i` to `10 i + 2`. */
const repeated = (count: number) =>
  cooked(
    [{ kind: 'mesh', tiles: [tile()] }],
    Array.from({ length: count }, (_, i) => ({
      ...{ node: i, collider: 0, position: [i * 10, 0, 0] },
      ...{ rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    })),
  )

/** `repeated(count)` opened by a tile streamer within `budget` (twice `count` bodies): the shapes
 *  its writer restores and releases, the shape each body it adds is built on, and the reads of the
 *  tile's object. */
async function streamed(count: number, budget: Partial<PhysicsBudget> = {}) {
  const streamer = await streamedModel(repeated(count), new Uint8Array(1), {
    ...{ bodies: 2 * count, ...budget },
  })
  const { writer, fetched } = streamer
  const [restored, released, builtOn] = [[], [], []] as number[][]
  const restore = writer.restore.bind(writer),
    release = writer.release.bind(writer),
    add = writer.add.bind(writer)
  writer.restore = (bytes) => {
    const handle = restore(bytes)
    restored.push(handle)
    return handle
  }
  writer.release = (handle) => (released.push(handle), release(handle))
  writer.add = (record) => (builtOn.push(record.indices![0]), add(record))
  const reads = () => fetched.filter((name) => name === 't0.bin').length
  return { ...streamer, restored, released, builtOn, reads }
}

test('a tile a model places 1,000 times within range is read once and restored once', async () => {
  const { tiles, bodies, errors, restored, reads } = await streamed(1000)
  tiles.update([0, 0, 0], 1e5)
  await landed()
  assert.deepEqual([reads(), restored.length, bodies.count.bodies, errors], [1, 1, 1000, []])
})

test('the bodies of a tile all reference its one shape, released once its last body leaves, never before', async () => {
  const { tiles, bodies, restored, released, builtOn } = await streamed(100)
  tiles.update([0, 0, 0], 1e5)
  await landed()
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
  const { tiles, bodies, errors, restored, reads } = await streamed(1000, {
    ...{ memoryBytes: 4, bodies: 600 },
  })
  tiles.update([0, 0, 0], 1e5)
  await landed()
  assert.deepEqual([bodies.count.collisionBytes, bodies.count.bodies, errors], [2, 600, []])
  const resident = Array.from({ length: 600 }, (_, i) => bodies.slots.at(i))
  const far = resident.map((owner) => (owner && 'tile' in owner ? owner.tile.box[0] : Infinity))
  assert.equal(Math.max(...far), 5990, 'the 600 nearest')
  // Nearer again: each body that leaves makes room for one that waited, on the shape held.
  tiles.update([10_000, 0, 0], 1e5)
  await landed()
  assert.deepEqual([bodies.count.bodies, restored.length, reads(), errors], [600, 1, 1, []])
})

test('a placement coming within range while its tile is resident gets its body with no read', async () => {
  const { tiles, bodies, restored, reads } = await streamed(2)
  // The first placement in, within 5 m of the eye; the second, 10 m away, out.
  tiles.update([0, 0, 0], 5)
  await landed()
  assert.deepEqual([bodies.count.bodies, reads()], [1, 1])
  // Between the two, 4 m from each: the second's body comes in the update itself.
  tiles.update([6, 0, 0], 5)
  assert.equal(bodies.count.bodies, 2)
  await landed()
  assert.deepEqual([reads(), restored.length], [1, 1])
})
