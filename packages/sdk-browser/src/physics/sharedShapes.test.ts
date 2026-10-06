import test from 'node:test'
import assert from 'node:assert/strict'
import { CommandWriter } from '../../../sdk-core/src/physics/index.ts'
import { SharedShapes } from './sharedShapes.ts'
import { hulled, opened, recorded, repeated, settle } from './tileShapes.fixture.ts'
import {
  compiledModel,
  cooked,
  landed,
  modelStreamer,
  place,
  sharedShapes,
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

test('a shape left bodiless again and again is listed for release once', () => {
  const { bodies } = modelStreamer()
  const shapes = sharedShapes(new CommandWriter(), bodies)
  const shape = shapes.hold('tile', 'https://cache.test/t.bin', 2, { tile: tile() })
  shapes.restore(shape, new Uint8Array(4))
  for (let i = 0; i < 1000; i++) {
    shapes.use(shape)
    shapes.done(shape)
  }
  assert.equal((shapes as unknown as { bare: unknown[] }).bare.length, 1, 'listed once')
  shapes.settle()
  assert.equal(shape.handle, -1, 'released')
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

test('a shape its restore refuses is reported once and left unrestored, never built on', async () => {
  stubFetch(cooked([], []), new Uint8Array(4))
  // A share of 4 bytes, past which a shape of ten is refused.
  const { bodies } = modelStreamer({ memoryBytes: 8 })
  const errors: { code: string }[] = []
  const writer = new CommandWriter()
  const shapes = new SharedShapes({ writer, bodies, failed: (error) => errors.push(error) })
  const shape = shapes.hold('hull', 'https://cache.test/model/x.bin', 10, {})
  assert.equal(await shapes.restored(shape), false)
  assert.deepEqual([shape.handle, errors.map((error) => error.code)], [-1, ['PHYSICS_BUDGET']])
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

test('bytes landed for tiles no update lets in count in the share, the farthest let go first for room', async () => {
  // A share of 4 bytes, two bodies.
  const file = cooked([{ kind: 'mesh', tiles: [tile(0), tile(20), tile(30)] }], [place(0)])
  const fetched = stubFetch(file, new Uint8Array(4))
  const { tiles, scene, bodies, writer } = modelStreamer({ memoryBytes: 8, bodies: 2 })
  const { restored } = recorded(writer)
  const reads = (name: string) => fetched.filter((file) => file === name).length
  tiles.scan(scene)
  await landed()
  // The two far tiles asked, then left before they land: their bytes kept, counted.
  tiles.update([25, 0, 0], 6)
  tiles.update([-50, 0, 0], 5)
  await landed()
  assert.deepEqual([bodies.count.collisionBytes, restored.length], [4, 0])
  // The near tile let in with the nearer kept one: the farthest kept bytes let go for it.
  await settle({ tiles, bodies, fetched }, [0, 0, 0], 40)
  const counts = [reads('t0.bin'), reads('t20.bin'), reads('t30.bin'), restored.length]
  assert.deepEqual(counts, [1, 1, 1, 2], 't20 restored from its kept bytes, t30 let go')
  assert.equal(bodies.count.collisionBytes, 4)
})
