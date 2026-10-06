import test from 'node:test'
import assert from 'node:assert/strict'
import { CommandWriter } from '../../../sdk-core/src/physics/index.ts'
import { hulled, opened, recorded, repeated, settle } from './tileShapes.fixture.ts'
import {
  compiledModel,
  landed,
  modelStreamer,
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
  assert.equal(bodies.count.collisionBytes, 2 + 3, 'the tile’s bytes, and the hull’s')
})

test('a shape left bodiless again and again is listed for release once', () => {
  const { bodies } = modelStreamer()
  const shapes = sharedShapes(new CommandWriter(), bodies)
  const shape = shapes.hold('tile', 'https://cache.test/t.bin', 2, { tile: tile() })
  shapes.restore(shape, new Uint8Array(4))
  shape.wanted = 1
  for (let i = 0; i < 1000; i++) {
    shapes.use(shape)
    shapes.done(shape)
  }
  shapes.settle(1)
  assert.equal((shapes as unknown as { bare: unknown[] }).bare.length, 1, 'kept, listed once')
})

test('an object a 4xx refuses is asked once and reported once, whatever names it after', async () => {
  const { file, crates } = hulled(2, 'hull.bin', 1)
  const fetched = stubFetch(file, new Uint8Array(4))
  const served = globalThis.fetch
  globalThis.fetch = (async (url: string) =>
    url.endsWith('hull.bin')
      ? (fetched.push('hull.bin'), new Response(null, { status: 404 }))
      : served(url)) as typeof fetch
  const streamer = modelStreamer({}, 1, crates)
  const { tiles, scene, model, errors } = streamer
  tiles.scan(scene)
  await landed()
  scene.remove(model)
  tiles.scan(scene)
  scene.add(model)
  tiles.scan(scene)
  await landed()
  const reads = fetched.filter((name) => name === 'hull.bin').length
  assert.deepEqual([reads, errors.map((error) => error.code)], [1, ['RESOURCE_HTTP_ERROR']])
})
