// The sky word and the sky light a saved scene carries, written and read back (`saved.test.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { Scene } from '../world/scene.ts'
import { light } from '../../../../sdk-core/src/world/light/light.ts'
import { sceneWithLoads } from './savedScene.fixture.ts'
import { SCENE_FORMAT_VERSION } from './format.ts'

test('the sky word is saved with the scene and read back', async () => {
  const scene = sceneWithLoads([])
  scene.sky = { clouds: false, sun: { intensity: 8 } }
  const saved = scene.toJSON()
  assert.deepEqual(
    [saved.formatVersion, saved.sky],
    [SCENE_FORMAT_VERSION, { clouds: false, sun: { intensity: 8 } }],
  )
  assert.equal('fog' in saved || 'atmosphere' in saved, false, 'the old fields are not written')
  scene.sky = null
  await scene.fromJSON(saved)
  assert.deepEqual(scene.sky, { clouds: false, sun: { intensity: 8 } })
})

test('a sky light cubemap held in a typed array is saved as numbers and read back as the same picture', async () => {
  const scene = sceneWithLoads([])
  const texels = Float32Array.from({ length: 6 * 3 }, (_, i) => i / 4)
  scene.sky = { skyLight: { sourceType: 'specifiedCubemap', cubemap: { size: 1, texels } } }
  const saved = scene.toJSON()
  const skyOf = (world: Scene) => world.sky as { skyLight: { cubemap: { texels: number[] } } }
  const word = saved.sky as ReturnType<typeof skyOf>
  assert.deepEqual(
    word.skyLight.cubemap.texels,
    Array.from(texels),
    'numbers, not an object of keys',
  )
  scene.sky = null
  await scene.fromJSON(JSON.parse(JSON.stringify(saved)))
  assert.deepEqual(Array.from(skyOf(scene).skyLight.cubemap.texels), Array.from(texels))
})

test('a version 2 scene moves its air, fog and sky light into the sky module once', async () => {
  const scene = sceneWithLoads([])
  const pointer = light.point({ intensity: 1 })
  scene.add(pointer)
  const old = { ...scene.toJSON(), formatVersion: 2, fog: {}, atmosphere: { planetRadius: 6000 } }
  const sky = { ...old.children[0], light: { ...old.children[0].light!, kind: 'sky' } }
  sky.light.values = { ...sky.light.values, intensity: 2 }
  await scene.fromJSON({ ...old, children: [sky] } as never)
  assert.equal(scene.children[0].children.length, 0, 'the sky light node is a plain node now')
  const word = scene.sky as Record<string, Record<string, unknown> | false>
  assert.deepEqual(
    [word.sun, word.clouds, (word.atmosphere as { planetRadius: number }).planetRadius],
    [false, false, 6000],
  )
  assert.deepEqual(
    word.heightFog,
    { baseDensity: 0.002, baseHeight: 0 },
    'the fog it had, not the level’s',
  )
  assert.equal((word.skyLight as { intensity: number }).intensity, 2)
  assert.equal((word.skyLight as { realTimeCapture: boolean }).realTimeCapture, false) // not every image
  assert.equal(
    (word.skyLight as { lowerHemisphereIsSolidColor: boolean }).lowerHemisphereIsSolidColor,
    true,
    'its ground colour still replaces the sky below',
  )
  await scene.fromJSON({ ...scene.toJSON(), sky: undefined, formatVersion: 2 })
  assert.equal(scene.sky, null, 'a version 2 scene without the three has no sky module')
})
