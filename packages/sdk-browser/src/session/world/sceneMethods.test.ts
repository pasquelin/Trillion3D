import test from 'node:test'
import assert from 'node:assert/strict'
import { namedMove } from './sceneMethods.ts'
import { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import { Scene } from './scene.ts'
import { createWorldModules, NO_SKY } from './worldModules.ts'

test('a move by name asks a frame only when the node moved', () => {
  const scene = new Object3D(),
    node = new Object3D()
  node.name = 'door'
  scene.add(node)
  scene.updateMatrixWorld(true)
  const moved: Object3D[] = []
  let frames = 0
  const move = namedMove(scene, { moved: (n) => moved.push(n) }, () => frames++)
  const at = (x: number) => Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1])
  move('door', at(2))
  assert.deepEqual([moved, frames], [[node], 1], 'a real move marks the node and asks a frame')
  move('door', at(2))
  assert.deepEqual([moved.length, frames], [1, 1], 'the same pose again asks nothing')
})

test('the scene’s sky word is checked, held and told to the world; a refused one changes nothing', () => {
  const scene = new Scene()
  const heard: unknown[] = []
  scene._link = { sky: (option: unknown) => heard.push(option) } as never
  assert.equal(scene.sky, undefined, 'off until a source says otherwise')
  scene.sky = { clouds: false, sun: { intensity: 8 } }
  assert.deepEqual(heard, [{ clouds: false, sun: { intensity: 8 } }])
  assert.throws(() => (scene.sky = { sun: { nope: 1 } }), /sun/)
  assert.throws(() => (scene.sky = { rain: true } as never), { code: 'INVALID_MODULE_OPTION' })
  assert.deepEqual(scene.sky, { clouds: false, sun: { intensity: 8 } })
  assert.equal(heard.length, 1)
  scene.sky = null
  assert.deepEqual([scene.sky, heard.at(-1)], [null, null])
})

test('the sky module is off and empty until a source switches it on, and the page’s word holds over the scene’s', () => {
  let changes = 0
  const modules = createWorldModules({ canvas: {} as never, changed: () => changes++ })
  assert.equal(modules.sky, NO_SKY, 'off: no part resolved, no light')
  modules.scene(true)
  const { resolved, lights } = modules.sky
  assert.deepEqual(
    [lights.map((l) => l.kind), Object.keys(resolved!).sort()],
    [['directional'], ['atmosphere', 'clouds', 'fog', 'skyLight', 'sun']],
  )
  modules.page.set('sky', { clouds: false, sun: false })
  assert.deepEqual(
    [modules.sky.lights.map((l) => l.kind), modules.sky.resolved!.clouds],
    [[], undefined],
  )
  modules.page.set('sky', false)
  assert.equal(modules.sky, NO_SKY, 'the page switches it off over the scene')
  modules.page.clear('sky')
  assert.equal(modules.sky.lights.length, 1, 'the scene’s word is back')
  assert.deepEqual([modules.page.state('sky').by, changes], ['scene', 4])
  modules.dispose()
  assert.equal(modules.sky, NO_SKY)
})

test('the sky light part holds a specified cubemap and its blend as data, refused when malformed', () => {
  const texels = new Float32Array(6 * 2 * 2 * 3).fill(0.5)
  const cube = { size: 2, texels }
  const modules = createWorldModules({ canvas: {} as never, changed: () => {} })
  const light = { realTimeCapture: false, sourceType: 'specifiedCubemap' }
  modules.scene({
    skyLight: { ...light, cubemap: cube, cubemapBlend: { destination: cube, fraction: 0.25 } },
  })
  const part = modules.sky.resolved!.skyLight!
  assert.equal(part.cubemap!.texels, texels, 'the data is kept, not copied')
  assert.deepEqual([part.cubemapBlend!.fraction, part.cubemapBlend!.destination.size], [0.25, 2])
  modules.scene({ skyLight: light })
  assert.equal(modules.sky.resolved!.skyLight!.cubemap, undefined, 'none unless given')
  const scene = new Scene()
  scene._link = { sky: () => {} } as never
  const refused = (skyLight: Readonly<Record<string, unknown>>) => () => (scene.sky = { skyLight })
  assert.throws(refused({ cubemap: { size: 2, texels: [1] } }), /texels expects 72 numbers/)
  assert.throws(refused({ cubemap: { size: 0, texels } }), /size must be a whole number/)
  assert.throws(refused({ cubemap: { size: 2, texels: texels.map(() => -1) } }), /finite numbers/)
  assert.throws(refused({ cubemapBlend: { destination: cube } }), /fraction must be a finite/)
  assert.throws(refused({ cubemapBlend: { destination: { size: 2 }, fraction: 1 } }), /destination/)
})
