import assert from 'node:assert/strict'
import test from 'node:test'
import { createSceneLightStore, type SceneLight } from '../../../sdk-core/src/index.ts'
import { attachContractLights } from './contractLights.ts'
import { installLighting } from './contractLightingApi.ts'
import { declareImportedLights } from './importedLights.ts'
import { unsupportedClusterLight } from '../webgl/cluster/lights.ts'
import { createDrawLists } from '../webgl/cluster/drawLists.ts'
import { Scene } from '../world/core/scene.ts'
import { Object3D } from '../../../sdk-core/src/world/object/object3d.ts'

// A scene declares as many lamps as it holds. The store takes every one of them and a
// file's lamps all arrive; WebGL2 takes them all too.

const lamps = (count: number): SceneLight[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `lamp${i}`,
    kind: 'point',
    position: [i, 2, 0],
    color: [1, 1, 1],
    intensity: 1,
    range: 10,
    castsShadow: i % 2 === 0,
  }))

test('300 imported lights: every one is declared, none dropped', () => {
  const store = createSceneLightStore()
  const declared = declareImportedLights(store, lamps(300))
  assert.equal(declared.length, 300)
  assert.equal(store.count, 300)
  assert.deepEqual(store.ids, declared)
})

test('WebGL2 takes 300 lights: no count refuses a scene', () => {
  const [scene, store] = [new Scene(), createSceneLightStore()]
  const contract = attachContractLights(
    scene,
    store,
    installLighting(scene, 0, new Object3D()),
    () => {},
  )
  for (const light of lamps(300)) store.add(light)
  contract.apply()
  const lists = createDrawLists(scene, [])
  lists.refresh()
  assert.equal(lists.lights.length, 300, 'the frame reads every lamp')
  assert.equal(unsupportedClusterLight(lists.lights), undefined)
  lists.dispose()
})
