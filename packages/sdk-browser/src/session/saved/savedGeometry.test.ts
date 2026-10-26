import test from 'node:test'
import assert from 'node:assert/strict'
import { Scene } from '../world/scene.ts'
import { object } from '../../../../sdk-core/src/world/object/index.ts'
import { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts'
import { geometry } from '../../../../sdk-core/src/world/geometry/index.ts'
import { light } from '../../../../sdk-core/src/world/light/light.ts'
import {
  BufferAttribute,
  InterleavedBuffer,
  InterleavedBufferAttribute,
} from '../../../../sdk-core/src/world/buffer/attribute.ts'

/** A scene that loads no model: these shapes are the page's own. */
const sceneOfShapes = () =>
  new Scene(async () => {
    throw new Error('no model is loaded here')
  })

/** The geometries of `scene` once saved and read back, in order. */
async function readBack(scene: Scene) {
  await scene.fromJSON(JSON.parse(JSON.stringify(scene.toJSON())))
  return scene.children.map((m) => (m as ReturnType<typeof object.mesh>).geometry)
}

// A saved view of an interleaved buffer held the whole pack under its own width.
test('a view of an interleaved buffer is saved as its own numbers, not the whole pack', async () => {
  const scene = sceneOfShapes()
  // Per vertex: x, y, z, u, v.
  const pack = new InterleavedBuffer(
    new Float32Array([0, 0, 0, 0.1, 0.2, 1, 0, 0, 0.3, 0.4, 0, 1, 0, 0.5, 0.6]),
    5,
  )
  // `createBuffer` takes owned lists only: the views are set one by one.
  const shape = new Geometry()
    .setAttribute('position', new InterleavedBufferAttribute(pack, 3, 0))
    .setAttribute('uv', new InterleavedBufferAttribute(pack, 2, 3))
  scene.add(object.mesh(shape))
  const [back] = await readBack(scene)
  assert.deepEqual(Array.from(back.attributes.position.array), [0, 0, 0, 1, 0, 0, 0, 1, 0])
  assert.deepEqual(
    Array.from(back.attributes.uv.array),
    Array.from(new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6])),
  )
})

// A host geometry is read at its value, a world one as stored; a saved one keeps its owner.
test('a shape keeps who built it, the world or the host, once saved and read back', async () => {
  const scene = sceneOfShapes()
  for (const owner of ['world', 'host'] as const) {
    const shape = geometry.createBuffer({
      position: new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3),
    })
    shape._owner = owner
    scene.add(object.mesh(shape))
  }
  const owners = (await readBack(scene)).map((back) => back._owner)
  assert.deepEqual(owners, ['world', 'host'])
})

test("a lamp's intensity unit is saved where it is not the default (unitless), and a version-3 rectangle's radiance is read as half that many nits", async () => {
  const scene = sceneOfShapes()
  const spot = light.spot({ intensity: 800, intensityUnits: 'lumens' })
  const bulb = light.point({ intensity: 20 })
  scene.add(spot, bulb)
  const saved = JSON.parse(JSON.stringify(scene.toJSON()))
  assert.equal(saved.children[0].light.intensityUnits, 'lumens')
  assert.equal(
    'intensityUnits' in saved.children[1].light,
    false,
    'the default unit is not written',
  )
  const again = sceneOfShapes()
  await again.fromJSON(saved)
  assert.deepEqual(again.toJSON(), saved)
  // Version 3 wrote a rectangle's radiance L, which shines L / 2 nits: the same light.
  const panel = light.rectArea({ intensity: 30, width: 2, height: 1 })
  const old = sceneOfShapes()
  old.add(panel)
  const three = { ...JSON.parse(JSON.stringify(old.toJSON())), formatVersion: 3 }
  delete three.children[0].light.intensityUnits
  await old.fromJSON(three)
  const read = old.children[0] as typeof panel
  assert.deepEqual([read.intensity, read.intensityUnits], [15, 'nits'])
  // A version-3 rectangle with no radiance is no version-3 scene: refused by name, the scene kept.
  delete three.children[0].light.values.intensity
  await assert.rejects(old.fromJSON(three), { code: 'UNSUPPORTED_SCENE_FORMAT' })
  assert.equal(old.children[0], read)
})
