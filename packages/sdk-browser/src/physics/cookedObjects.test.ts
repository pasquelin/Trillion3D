import test from 'node:test'
import assert from 'node:assert/strict'
import { cloth, hulled, opened, recorded, settle } from './tileShapes.fixture.ts'
import {
  cooked,
  declared,
  fixture,
  landed,
  modelStreamer,
  place,
  stubFetch,
  tile,
} from './tiles.fixture.ts'

/** The engine ids of the declared bodies among the first eight slots of `bodies`. */
const crateIds = (bodies: Awaited<ReturnType<typeof opened>>['bodies']) =>
  Array.from({ length: 8 }, (_, slot) => bodies.slots.at(slot)).flatMap((owner) =>
    owner && 'body' in owner ? [owner.body.id] : [],
  )

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

test('a hull counts its bytes once and lives while its opening holds it, every body of it refused', async () => {
  const { file, crates } = hulled(3, 'hull.bin', 5)
  const { tiles, scene, bodies, released, fetched } = await opened(file, crates)
  assert.equal(bodies.count.collisionBytes, 2 + 5)
  for (const id of crateIds(bodies)) tiles.refused(id)
  assert.deepEqual([released, bodies.count.collisionBytes], [[], 2 + 5], 'its opening holds it')
  scene.clear()
  tiles.scan(scene)
  assert.deepEqual([released.length, bodies.count.collisionBytes], [2, 0], 'its model gone')
  assert.equal(fetched.filter((name) => name === 'hull.bin').length, 1)
})

test('the bytes a hull holds are none the tiles can give back: a tile past what it leaves waits, unread', async () => {
  const { file, crates } = hulled(1, 'hull.bin', 3)
  // A share of 4 bytes: the hull's three leave one, short of the tile's two.
  const { bodies, errors, fetched } = await opened(file, crates, { memoryBytes: 8 })
  assert.deepEqual([bodies.count.collisionBytes, bodies.count.bodies, errors], [3, 1, []])
  assert.ok(fetched.filter((name) => name === 'tile.bin').length <= 1, 'never asked again')
})

test('a hull landing past the room the tiles hold waits for them to leave it: its body is built', async () => {
  // Two two-byte tiles fill a share of 4 bytes before the crate's hull, two bytes, lands.
  const collider = { kind: 'mesh', tiles: [tile(0), tile(10)] }
  const hull = { type: 'cooked', url: 'hull.bin', sha256: 'h'.repeat(64), bytes: 2 }
  const crate = declared(1, [20, 0, 0], { isKinematic: true }, hull)
  const file = { ...cooked([collider], [place(0)]), bodies: [crate] }
  const fetched = stubFetch(file, new Uint8Array(4))
  const served = globalThis.fetch
  let land = () => {}
  const held = new Promise<void>((resolve) => (land = resolve))
  globalThis.fetch = (async (url: string) => {
    if (url.endsWith('hull.bin')) await held
    return served(url)
  }) as typeof fetch
  const streamer = modelStreamer({ memoryBytes: 8 }, 1, [crate])
  const { tiles, scene, bodies, errors } = streamer
  tiles.scan(scene)
  await landed()
  await settle({ ...streamer, fetched }, [0, 0, 0], 100)
  assert.deepEqual([bodies.count.collisionBytes, bodies.count.bodies], [4, 2], 'two tiles')
  land()
  await settle({ ...streamer, fetched }, [0, 0, 0], 100)
  assert.deepEqual([bodies.count.collisionBytes, bodies.count.bodies, errors], [4, 2, []])
  const owners = Array.from({ length: 8 }, (_, slot) => bodies.slots.at(slot))
  assert.ok(
    owners.some((owner) => owner && 'body' in owner),
    'the crate built, the farther tile left',
  )
})

test('two cloths made from one settings object read it once, and keep it while they are held', async () => {
  const settings = { url: 'cloth.bin', sha256: 'c'.repeat(64), bytes: 4 }
  const file = cooked([], [], [cloth(0, settings), cloth(1, settings)])
  const { fetched, bodies, errors } = await opened(file, [])
  const reads = fetched.filter((name) => name === 'cloth.bin').length
  assert.deepEqual([reads, bodies.count.softVertices, errors], [1, 18, []])
})

test('a model opened again makes its cloth from the settings it read: no read again', async () => {
  const settings = { url: 'cloth.bin', sha256: 'c'.repeat(64), bytes: 4 }
  const { tiles, scene, model, bodies, fetched } = await opened(
    cooked([], [], [cloth(0, settings)]),
    [],
  )
  scene.remove(model)
  tiles.scan(scene)
  assert.equal(bodies.count.softVertices, 0, 'out with its model')
  scene.add(model)
  tiles.scan(scene)
  await landed()
  const reads = fetched.filter((name) => name === 'cloth.bin').length
  assert.deepEqual([reads, bodies.count.softVertices], [1, 9])
})
