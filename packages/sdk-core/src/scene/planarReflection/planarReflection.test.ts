// The planar reflections' contract and store (`./contracts.ts`, `./store.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolvePlanarReflection } from './contracts.ts'
import { createScenePlanarReflectionStore } from './store.ts'

test('a planar reflection: the reference defaults in metres, each field held to its range, a wrong field refused', () => {
  const bare = resolvePlanarReflection({ id: 'a' })
  assert.deepEqual(
    { ...bare, matrix: undefined },
    {
      id: 'a',
      matrix: undefined,
      normalDistortionStrength: 5,
      prefilterRoughness: 0.01,
      prefilterRoughnessDistance: 100,
      screenPercentage: 50,
      extraFov: 0,
      distanceFromPlaneFadeoutStart: 0.6,
      distanceFromPlaneFadeoutEnd: 1,
      angleFromPlaneFadeStart: 20,
      angleFromPlaneFadeEnd: 30,
      hidden: [],
    },
  )
  const held = resolvePlanarReflection({
    id: 'b',
    prefilterRoughness: 1,
    screenPercentage: 5,
    extraFov: -4,
    angleFromPlaneFadeStart: 0,
    angleFromPlaneFadeEnd: 120,
    distanceFromPlaneFadeoutStart: -1,
  })
  assert.deepEqual(
    [
      held.prefilterRoughness,
      held.screenPercentage,
      held.extraFov,
      held.angleFromPlaneFadeStart,
      held.angleFromPlaneFadeEnd,
      held.distanceFromPlaneFadeoutStart,
    ],
    [0.04, 25, 0, 0.1, 89.9, 0],
  )
  for (const wrong of [
    { id: '' },
    { id: 'c', matrix: [1, 0, 0] },
    { id: 'd', matrix: [0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
    { id: 'e', prefilterRoughness: NaN },
    { id: 'f', hidden: 'water' as unknown as [] },
  ])
    assert.throws(() => resolvePlanarReflection(wrong), { code: 'INVALID_SCENE_PLANAR_REFLECTION' })
})

test('the store: names are unique, a patch changes one field, a setting to the same value moves nothing', () => {
  const store = createScenePlanarReflectionStore()
  store.add({ id: 'lake' })
  assert.throws(() => store.add({ id: 'lake' }), { code: 'DUPLICATE_SCENE_PLANAR_REFLECTION' })
  const revision = store.revision
  store.set('lake', { screenPercentage: 50 })
  assert.equal(store.revision, revision)
  store.set('lake', { screenPercentage: 75 })
  assert.equal(store.get('lake')?.screenPercentage, 75)
  assert.throws(() => store.remove('pond'), { code: 'UNKNOWN_SCENE_PLANAR_REFLECTION' })
  store.remove('lake')
  assert.equal(store.count, 0)
})
