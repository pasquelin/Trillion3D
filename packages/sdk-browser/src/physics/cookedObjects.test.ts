import test from 'node:test'
import assert from 'node:assert/strict'
import { cloth, hulled, opened, recorded } from './tileShapes.fixture.ts'
import {
  compiledModel,
  cooked,
  declared,
  fixture,
  landed,
  modelStreamer,
  stubFetch,
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

test('two cloths made from one settings object read it once, and keep it while they are held', async () => {
  const settings = { url: 'cloth.bin', sha256: 'c'.repeat(64), bytes: 4 }
  const file = cooked([], [], [cloth(0, settings), cloth(1, settings)])
  const { fetched, bodies, errors } = await opened(file, [])
  const reads = fetched.filter((name) => name === 'cloth.bin').length
  assert.deepEqual([reads, bodies.count.softVertices, errors], [1, 18, []])
})

test('a declared body’s hull counts no static collision: a share the tiles fill still builds it', async () => {
  // A share of 2 bytes, the tile's two: the crate's hull, ten bytes, its own shape.
  const { file, crates } = hulled(1, 'hull.bin', 10)
  const { bodies, errors, restored } = await opened(file, crates, { memoryBytes: 4 })
  assert.deepEqual([bodies.count.bodies, bodies.count.collisionBytes, errors], [2, 2, []])
  assert.equal(restored.length, 2, 'the tile and the hull')
})

test('a hull lives while its opening holds it, every body of it refused, and leaves with it', async () => {
  const { file, crates } = hulled(3, 'hull.bin', 5)
  const { tiles, scene, bodies, released, fetched } = await opened(file, crates)
  for (const id of crateIds(bodies)) tiles.refused(id)
  assert.deepEqual([released, bodies.count.bodies], [[], 1], 'its opening holds it')
  scene.clear()
  tiles.scan(scene)
  assert.deepEqual([released.length, bodies.count.collisionBytes], [2, 0], 'its model gone')
  assert.equal(fetched.filter((name) => name === 'hull.bin').length, 1)
})

test('a cloth’s settings serve its remake at its scale, and leave with its model', async () => {
  const settings = { url: 'cloth.bin', sha256: 'c'.repeat(64), bytes: 4 }
  const streamer = await opened(cooked([], [], [cloth(0, settings)]), [])
  const { tiles, scene, model, bodies, fetched } = streamer
  const reads = () => fetched.filter((name) => name === 'cloth.bin').length
  for (const scale of [2, 1]) {
    model.scale.setScalar(scale)
    model.updateMatrixWorld(true)
    tiles.moved(model)
    await landed()
  }
  assert.deepEqual([reads(), bodies.count.softVertices], [1, 9], 'made again, nothing read')
  scene.remove(model)
  tiles.scan(scene)
  scene.add(model)
  tiles.scan(scene)
  await landed()
  assert.deepEqual([reads(), bodies.count.softVertices], [2, 9], 'opened again: read again')
})

test('a second load of an asset makes its cloth from the settings the first one read', async () => {
  const settings = { url: 'cloth.bin', sha256: 'c'.repeat(64), bytes: 4 }
  const fetched = stubFetch(cooked([], [], [cloth(0, settings)]), new Uint8Array(4))
  const { tiles, scene, bodies } = modelStreamer()
  tiles.scan(scene)
  await landed()
  // The same asset loaded again once the first one's cloth is made.
  scene.add(compiledModel())
  tiles.scan(scene)
  await landed()
  const reads = fetched.filter((name) => name === 'cloth.bin').length
  assert.deepEqual([reads, bodies.count.softVertices], [1, 18])
})

test('declared bodies on a cooked hull count no static bytes, each or shared, as before the registry', async () => {
  const hull = { type: 'cooked', url: 'hull.bin', sha256: 'h'.repeat(64), bytes: 500 }
  const crates = [1, 2, 3].map((node) =>
    declared(node, [node * 3, 0, 0], { isKinematic: true }, hull),
  )
  stubFetch({ ...cooked([], []), bodies: crates }, new Uint8Array(4))
  const { tiles, scene, bodies } = modelStreamer({}, 1, crates)
  tiles.scan(scene)
  await landed()
  assert.deepEqual([bodies.count.bodies, bodies.count.collisionBytes], [3, 0])
})
