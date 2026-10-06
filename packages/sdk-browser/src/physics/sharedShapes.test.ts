import test from 'node:test'
import assert from 'node:assert/strict'
import type { CookedBody, CookedSoftBody } from '../../../sdk-core/src/physics/index.ts'
import { recorded, repeated, settle } from './tileShapes.fixture.ts'
import {
  compiledModel,
  cooked,
  declared,
  fixture,
  landed,
  modelStreamer,
  place,
  stubFetch,
  tile,
} from './tiles.fixture.ts'

test('two loads of one asset share its tile: one read, one shape, released once both have left', async () => {
  const fetched = stubFetch(repeated(1), new Uint8Array(1))
  const streamer = modelStreamer()
  const { tiles, scene, model, bodies, writer } = streamer
  const { restored, released, builtOn } = recorded(writer)
  // The same asset loaded again, 5 m aside: its manifest beside the first one's.
  const twin = compiledModel()
  twin.position.set(0, 0, 5)
  twin.updateMatrixWorld(true)
  scene.add(twin)
  tiles.scan(scene)
  await landed()
  await settle({ ...streamer, fetched }, [0, 0, 0], 100)
  const reads = (name: string) => fetched.filter((file) => file === name).length
  assert.deepEqual([reads('physics.json'), reads('t0.bin'), restored.length], [2, 1, 1])
  assert.deepEqual([bodies.count.bodies, builtOn], [2, [restored[0], restored[0]]])
  scene.remove(model)
  tiles.scan(scene)
  assert.deepEqual([bodies.count.bodies, released], [1, []], 'the twin still on it')
  scene.remove(twin)
  tiles.scan(scene)
  assert.deepEqual([bodies.count.bodies, released], [0, restored])
})

test('a hull three declared bodies share is read and restored once, each body built on it', async () => {
  const hull = { type: 'cooked', url: 'hull.bin', sha256: 'h'.repeat(64), bytes: 1 }
  const crates = [0, 1, 2].map((node) =>
    declared(node, [node * 3, 0, 0], { isKinematic: true }, hull),
  )
  const fetched = stubFetch({ ...cooked([], []), bodies: crates }, await fixture('cube-hull.bin'))
  const { tiles, scene, writer, bodies } = modelStreamer({}, 1, crates)
  const { restored, released, builtOn } = recorded(writer)
  tiles.scan(scene)
  await landed()
  assert.deepEqual([fetched.filter((file) => file === 'hull.bin').length, restored.length], [1, 1])
  assert.deepEqual([bodies.count.bodies, builtOn], [3, [restored[0], restored[0], restored[0]]])
  scene.clear()
  tiles.scan(scene)
  assert.deepEqual([bodies.count.bodies, released], [0, restored], 'released with its model')
})

/** A model's `physics.json`: one tile of `tile.bin` placed at the origin, and kinematic bodies on
 *  nodes 1 to `count`, 3 m apart, each built on the hull `url` of `bytes` bytes. */
function hulled(count: number, url: string, bytes: number) {
  const hull = { type: 'cooked', url, sha256: 'h'.repeat(64), bytes }
  const crates = Array.from({ length: count }, (_, i) =>
    declared(i + 1, [i * 3 + 3, 0, 0], { isKinematic: true }, hull),
  )
  const file = {
    ...cooked([{ kind: 'mesh', tiles: [{ ...tile(), url: 'tile.bin' }] }], [place(0)]),
  }
  return { file: { ...file, bodies: crates }, crates }
}

/** `file` opened by a streamer within `budget`, its `crates` numbered, every file `bytes`: the
 *  streamer, what its writer writes, and the files it asked. */
async function opened(file: object, crates: CookedBody[], budget = {}, bytes = new Uint8Array(4)) {
  const fetched = stubFetch(file, bytes)
  const streamer = modelStreamer(budget, 1, crates)
  const written = recorded(streamer.writer)
  streamer.tiles.scan(streamer.scene)
  await landed()
  await settle({ ...streamer, fetched }, [0, 0, 0], 100)
  return { ...streamer, ...written, fetched }
}

test('a tile and a hull of one URL are two shapes, each restored with what it holds', async () => {
  const { file, crates } = hulled(1, 'tile.bin', 3)
  const { bodies, errors, restored, builtOn } = await opened(file, crates)
  assert.deepEqual([errors, restored.length, bodies.count.bodies], [[], 2, 2])
  assert.equal(new Set(builtOn).size, 2, 'the tile body on the tile, the crate on the hull')
  assert.equal(bodies.count.collisionBytes, 2 + 3, 'the tile’s bytes, and the hull’s')
})

test('a hull past the collision share refuses its body by name, which is added on no shape', async () => {
  const { file, crates } = hulled(1, 'hull.bin', 10)
  // A share of 4 bytes: the tile's two, never the hull's ten.
  const { bodies, errors, restored, builtOn } = await opened(file, crates, { memoryBytes: 8 })
  assert.deepEqual(
    errors.map((error) => error.code),
    ['PHYSICS_BUDGET'],
  )
  assert.deepEqual([restored.length, builtOn.length, bodies.count.bodies], [1, 1, 1], 'the tile')
})

test('a hull counts its bytes once while a body is built on it, and leaves with the last', async () => {
  const { file, crates } = hulled(3, 'hull.bin', 5)
  const { tiles, bodies, released } = await opened(file, crates)
  assert.equal(bodies.count.collisionBytes, 2 + 5)
  const ids = Array.from({ length: 8 }, (_, slot) => bodies.slots.at(slot)).flatMap((owner) =>
    owner && 'body' in owner ? [owner.body.id] : [],
  )
  for (const id of ids.slice(1)) tiles.refused(id)
  assert.deepEqual([released, bodies.count.collisionBytes], [[], 2 + 5], 'one crate still on it')
  tiles.refused(ids[0])
  const left = [released.length, bodies.count.collisionBytes, bodies.count.bodies]
  assert.deepEqual(left, [1, 2, 1], 'the hull released, the tile kept')
})

test('two cloths made from one settings object read it once, and keep it while they are held', async () => {
  const settings = { url: 'cloth.bin', sha256: 'c'.repeat(64), bytes: 4 }
  const cloth = (node: number): CookedSoftBody => ({
    ...{ node, position: [node * 3, 2, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    ...{ physics: { type: 'cloth', pins: [0] }, vertices: 9, pressure: 0 },
    ...{ friction: 0.5, restitution: 0, settings },
  })
  const file = cooked([], [], [cloth(0), cloth(1)])
  const { fetched, bodies, errors } = await opened(file, [])
  const reads = fetched.filter((name) => name === 'cloth.bin').length
  assert.deepEqual([reads, bodies.count.softVertices, errors], [1, 18, []])
})

test('the bytes a hull holds are none the tiles can give back: a tile past what it leaves waits, unread', async () => {
  const { file, crates } = hulled(1, 'hull.bin', 3)
  // A share of 4 bytes: the hull's three leave one, short of the tile's two.
  const { bodies, errors, fetched } = await opened(file, crates, { memoryBytes: 8 })
  assert.deepEqual([bodies.count.collisionBytes, bodies.count.bodies, errors], [3, 1, []])
  assert.ok(fetched.filter((name) => name === 'tile.bin').length <= 1, 'never asked again')
})
