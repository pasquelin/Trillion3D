import test from 'node:test'
import assert from 'node:assert/strict'
import { box } from '../../../sdk-core/src/world/geometry/basic.ts'
import { Material } from '../../../sdk-core/src/world/material/material.ts'
import { Mesh } from '../../../sdk-core/src/world/object/mesh.ts'
import { SharedShapes } from './sharedShapes.ts'
import { hulled, opened, recorded, repeated } from './tileShapes.fixture.ts'
import {
  compiledModel,
  cooked,
  landed,
  modelStreamer,
  place,
  settle,
  sharedShapes,
  streamedModel,
  stubFetch,
  tile,
} from './tiles.fixture.ts'

/** The streamer of `repeated(1)` at the origin and its twin, 5 m aside, scanned and opened: what
 *  its writer writes recorded. */
async function twins() {
  const fetched = stubFetch(repeated(1), new Uint8Array(1))
  const streamer = modelStreamer()
  const twin = compiledModel()
  twin.position.set(0, 0, 5)
  twin.updateMatrixWorld(true)
  streamer.scene.add(twin)
  const written = recorded(streamer.writer)
  streamer.tiles.scan(streamer.scene)
  await landed()
  return { ...streamer, ...written, twin, fetched }
}

test('two loads of one asset share its tile: one read, one shape, released once both have left', async () => {
  // The same asset loaded again, 5 m aside: its manifest beside the first one's.
  const streamer = await twins()
  const { tiles, scene, model, bodies, restored, released, builtOn, twin, fetched } = streamer
  await settle(streamer, [0, 0, 0], 100)
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

test('a tile and a hull of one URL are two shapes, each restored with what it holds', async () => {
  const { file, crates } = hulled(1, 'tile.bin', 3)
  const { bodies, errors, restored, builtOn } = await opened(file, crates)
  assert.deepEqual([errors, restored.length, bodies.count.bodies], [[], 2, 2])
  assert.equal(new Set(builtOn).size, 2, 'the tile body on the tile, the crate on the hull')
  assert.equal(
    bodies.count.collisionBytes,
    2,
    'the tile’s bytes; the hull, its body’s own shape, none',
  )
})

test('a model leaving while its tile is on its way builds nothing on it: the tile leaves with the last that stays', async () => {
  const { tiles, scene, model, bodies, restored, released, twin } = await twins()
  tiles.update([0, 0, 0], 100)
  scene.remove(model)
  tiles.scan(scene)
  await landed()
  assert.deepEqual([bodies.count.bodies, restored.length], [1, 1], 'the twin’s body alone')
  scene.remove(twin)
  tiles.scan(scene)
  assert.deepEqual([bodies.count.bodies, released], [0, restored])
})

test('a shape left bodiless again and again is released once', async () => {
  stubFetch(cooked([], []), new Uint8Array(4))
  const { bodies, writer } = modelStreamer()
  const { restored, released } = recorded(writer)
  const shapes = sharedShapes(writer, bodies)
  const shape = shapes.hold('tile', 'https://cache.test/t.bin', 2, { tile: tile() })
  assert.equal(await shapes.restored(shape), true)
  for (let i = 0; i < 1000; i++) {
    shapes.use(shape)
    shapes.done(shape)
  }
  shapes.settle()
  shapes.settle()
  assert.deepEqual([shape.handle, released], [-1, restored])
})

test('a 4xx is asked and reported once while its object is held; held again after, asked again', async () => {
  const { file, crates } = hulled(2, 'hull.bin', 1)
  const fetched = stubFetch(file, new Uint8Array(4))
  const served = globalThis.fetch
  globalThis.fetch = (async (url: string) =>
    url.endsWith('hull.bin')
      ? (fetched.push('hull.bin'), new Response(null, { status: 404 }))
      : served(url)) as typeof fetch
  const { tiles, scene, model, errors } = modelStreamer({}, 1, crates)
  const reads = () => fetched.filter((name) => name === 'hull.bin').length
  tiles.scan(scene)
  await landed()
  assert.deepEqual([reads(), errors.length], [1, 1], 'two bodies name it: one request, one report')
  scene.remove(model)
  tiles.scan(scene)
  scene.add(model)
  tiles.scan(scene)
  await landed()
  assert.deepEqual(
    [reads(), errors.map((error) => error.code)],
    [2, ['RESOURCE_HTTP_ERROR', 'RESOURCE_HTTP_ERROR']],
  )
})

test('a read failing with no error object is reported, never thrown', async () => {
  const { file, crates } = hulled(1, 'hull.bin', 1)
  const fetched = stubFetch(file, new Uint8Array(4))
  const served = globalThis.fetch
  const torn = { ok: true, status: 200, arrayBuffer: () => Promise.reject('torn') }
  globalThis.fetch = (async (url: string) =>
    url.endsWith('hull.bin') ? (fetched.push('hull.bin'), torn) : served(url)) as typeof fetch
  const { tiles, scene, errors } = modelStreamer({}, 1, crates)
  tiles.scan(scene)
  await landed()
  assert.deepEqual(errors, ['torn'])
})

test('a shape past the share as it lands is left unrestored, never built on, and no failure', async () => {
  stubFetch(cooked([], []), new Uint8Array(4))
  // A share of 4 bytes, past which a tile of ten waits.
  const { bodies, writer } = modelStreamer({ memoryBytes: 8 })
  const { restored } = recorded(writer)
  const shapes = new SharedShapes({ writer, bodies, failed: assert.fail })
  const shape = shapes.hold('tile', 'https://cache.test/model/x.bin', 10, {})
  assert.equal(await shapes.restored(shape), false)
  assert.deepEqual([shape.handle, restored, bodies.count.collisionBytes], [-1, [], 0])
})

test('a shared shape’s bytes are claimed in the bodies’ ledger under it, checked as theirs', () => {
  // A share of 4 bytes.
  const { bodies } = modelStreamer({ memoryBytes: 8 })
  const [shape, other] = [{}, {}]
  bodies.claimShape(shape, 3)
  assert.throws(() => bodies.claimShape(other, 2), { code: 'PHYSICS_BUDGET' })
  bodies.releaseShape(shape)
  bodies.claimShape(other, 2)
  assert.equal(bodies.count.collisionBytes, 2)
})

test('a shape whose last holder let go while it was read is never restored', async () => {
  stubFetch(cooked([], []), new Uint8Array(4))
  const { bodies, writer } = modelStreamer()
  const { restored } = recorded(writer)
  const shapes = new SharedShapes({ writer, bodies, failed: assert.fail })
  const shape = shapes.hold('hull', 'https://cache.test/model/x.bin', 0, {})
  const made = shapes.restored(shape)
  shapes.letGo(shape)
  assert.deepEqual([await made, shape.handle, restored], [false, -1, []])
})

test('bytes landing for a tile no update lets in any more count nothing: a page mesh still fits the share', async () => {
  // A share of 200 bytes, a tile of 150, a page mesh of twelve triangles: 192.
  const file = cooked([{ kind: 'mesh', tiles: [{ ...tile(), bytes: 150 }] }], [place(0)])
  const { tiles, bodies, scene, writer } = await streamedModel(file, new Uint8Array(1), {
    memoryBytes: 400,
  })
  const { restored } = recorded(writer)
  tiles.update([0, 0, 0], 10)
  // Left out before its bytes land: they are dropped.
  tiles.update([100, 0, 0], 10)
  await landed()
  const wall = new Mesh(box(1, 1, 1), new Material('meshStandard'))
  wall.physics = { type: 'static', shape: { type: 'triangles' } }
  scene.add(wall)
  bodies.reconcile(new Set(), (error) => assert.fail(String(error)))
  assert.deepEqual([bodies.count.collisionBytes, restored], [192, []])
})
