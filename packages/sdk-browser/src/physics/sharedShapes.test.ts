import test from 'node:test'
import assert from 'node:assert/strict'
import { recorded, repeated, settle } from './tileShapes.fixture.ts'
import {
  compiledModel,
  cooked,
  declared,
  fixture,
  landed,
  modelStreamer,
  stubFetch,
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
