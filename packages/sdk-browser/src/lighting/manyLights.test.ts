import assert from 'node:assert/strict'
import test from 'node:test'
import { createSceneLightStore, type SceneLight } from '../../../sdk-core/src/index.ts'
import { declareImportedLights } from './importedLights.ts'

// #822: a scene declares as many lamps as it holds. The store takes every one of them and a
// file's lamps all arrive.

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
