import test from 'node:test'
import assert from 'node:assert/strict'
import type { PhysicsBudget } from '../../../sdk-core/src/physics/index.ts'
import { box } from '../../../sdk-core/src/world/geometry/basic.ts'
import { Material } from '../../../sdk-core/src/world/material/material.ts'
import { Mesh } from '../../../sdk-core/src/world/object/mesh.ts'
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
  // A share of 2 bytes, the tile's alone, and 600 bodies of the tiles for 1,000 placements.
  const streamer = await streamed(1000, { memoryBytes: 4, bodies: 1200 })
  const { bodies, errors, restored, reads } = streamer
  await settle(streamer, [0, 0, 0], 1e5)
  assert.deepEqual([bodies.count.collisionBytes, bodies.count.bodies, errors], [2, 600, []])
  assert.equal(Math.max(...residentAt(bodies, 1200)), 5990, 'the 600 nearest')
  // Nearer the other end: each body that leaves makes room for one that waited, on the shape held.
  await settle(streamer, [10_000, 0, 0], 1e5)
  assert.deepEqual([bodies.count.bodies, restored.length, reads(), errors], [600, 1, 1, []])
  assert.equal(Math.min(...residentAt(bodies, 1200)), 4000, 'the 600 nearest the other end')
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

test('tile bodies hold half the body budget at most: the page’s bodies keep the rest', async () => {
  const streamer = await streamed(100, { bodies: 8 })
  const { scene, bodies, errors } = streamer
  await settle(streamer, [0, 0, 0], 1e5)
  assert.equal(bodies.count.bodies, 4, 'the four nearest placements')
  for (let i = 0; i < 4; i++) {
    const crate = new Mesh(box(1, 1, 1), new Material('meshStandard'))
    crate.physics = 'dynamic'
    scene.add(crate)
  }
  bodies.reconcile(new Set(), (error) => assert.fail(String(error)))
  assert.deepEqual([bodies.count.bodies, errors], [8, []])
})

test('the bodies an update leaves unbuilt ask another frame; none left, none is asked', async () => {
  const streamer = await streamed(100)
  const { tiles, bodies, heard } = streamer
  /** Whether `tiles.update` asks another frame before its reads land. */
  const asks = async () => {
    const asked = heard().then(() => true)
    tiles.update([0, 0, 0], 1e5)
    return Promise.race([asked, landed().then(() => false)])
  }
  await asks()
  assert.deepEqual([await asks(), bodies.count.bodies], [true, 64], 'thirty-six still to build')
  assert.deepEqual([await asks(), bodies.count.bodies], [false, 100])
})

test('a body the worker refuses takes its placement out alone: the others stay on the tile', async () => {
  const streamer = await streamed(3)
  const { tiles, bodies, released, builtOn } = streamer
  await settle(streamer, [0, 0, 0], 1e5)
  const owner = bodies.slots.at(0)
  assert.ok(owner && 'tile' in owner)
  tiles.refused([owner.tile.id])
  await settle(streamer, [0, 0, 0], 1e5)
  assert.deepEqual([bodies.count.bodies, released, builtOn.length], [2, [], 3], 'never built again')
})

test('a tile that fails as it lands is reported, never left unhandled', async () => {
  const streamer = await streamed(1)
  const { tiles, writer, errors } = streamer
  writer.restore = () => {
    throw new Error('the module is gone')
  }
  tiles.update([0, 0, 0], 1e5)
  await landed()
  assert.deepEqual(
    errors.map((error) => (error as unknown as Error).message),
    ['the module is gone'],
  )
})

test('a tile all of whose bodies the worker refuses has its shape refused: it leaves whole', async () => {
  const streamer = await streamed(3)
  const { tiles, bodies, builtOn, reads } = streamer
  await settle(streamer, [0, 0, 0], 1e5)
  const ids = Array.from({ length: 6 }, (_, slot) => bodies.slots.at(slot)).flatMap((owner) =>
    owner && 'tile' in owner ? [owner.tile.id] : [],
  )
  tiles.refused(ids)
  await settle(streamer, [0, 0, 0], 1e5)
  assert.deepEqual([bodies.count.bodies, builtOn.length, reads()], [0, 3, 1], 'built on no more')
})

test('a model placing a tile 200,000 times opens: its placements are no call’s arguments', async () => {
  const streamer = await streamed(200_000, { bodies: 16 })
  await settle(streamer, [0, 0, 0], 25)
  assert.deepEqual([streamer.bodies.count.bodies, streamer.errors], [3, []])
})
