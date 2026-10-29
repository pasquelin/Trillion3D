// The reflection captures' contract and store (`./contracts.ts`, `./store.ts`) and their settings.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  REFLECTION_CAPTURE_RULES,
  reflectionCaptureSide,
} from '../../contracts/reflectionCaptureOptions.ts'
import { resolveSettings } from '../../contracts/settingRules.ts'
import { reflectionCaptureRadius, resolveReflectionCapture } from './contracts.ts'
import { createSceneReflectionCaptureStore } from './store.ts'

test('a reflection capture: the reference defaults in metres, each field held to its range, a wrong field refused', () => {
  const bare = resolveReflectionCapture({ id: 'a' })
  assert.deepEqual(
    { ...bare, matrix: undefined },
    {
      id: 'a',
      shape: 'sphere',
      matrix: undefined,
      influenceRadius: 30,
      boxTransitionDistance: 1,
      brightness: 1,
      captureOffset: [0, 0, 0],
    },
  )
  const held = resolveReflectionCapture({
    id: 'b',
    influenceRadius: 0,
    boxTransitionDistance: -3,
    brightness: -1,
  })
  assert.deepEqual(
    [held.influenceRadius, held.boxTransitionDistance, held.brightness],
    [0.08, 0, 0],
  )
  for (const wrong of [
    { id: '' },
    { id: 'c', shape: 'plane' as 'box' },
    { id: 'd', matrix: [1, 0, 0] },
    { id: 'e', captureOffset: [0, 0] as unknown as [number, number, number] },
    { id: 'f', brightness: NaN },
  ])
    assert.throws(() => resolveReflectionCapture(wrong), {
      code: 'INVALID_SCENE_REFLECTION_CAPTURE',
    })
})

test('the radius that orders captures: a sphere its radius, a box the length of its half extents', () => {
  assert.equal(
    reflectionCaptureRadius(resolveReflectionCapture({ id: 's', influenceRadius: 7 })),
    7,
  )
  const box = resolveReflectionCapture({
    id: 'x',
    shape: 'box',
    matrix: [3, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1].map((v, i) => (i === 10 ? 12 : v)),
  })
  assert.equal(reflectionCaptureRadius(box), 13)
})

test('the store: names unique, a change bumps the revision, the same value changes nothing', () => {
  const store = createSceneReflectionCaptureStore()
  store.add({ id: 'a', brightness: 2 })
  assert.throws(() => store.add({ id: 'a' }), { code: 'DUPLICATE_SCENE_REFLECTION_CAPTURE' })
  const revision = store.revision
  store.set('a', { brightness: 2 })
  assert.equal(store.revision, revision)
  store.set('a', { brightness: 3 })
  assert.equal(store.get('a')!.brightness, 3)
  assert.throws(() => store.set('zz', {}), { code: 'UNKNOWN_SCENE_REFLECTION_CAPTURE' })
})

test('the settings: the reference defaults, the cube side the power of two at or below the resolution', () => {
  const s = resolveSettings(REFLECTION_CAPTURE_RULES, {})
  assert.deepEqual(s, {
    reflectionCaptures: true,
    reflectionCaptureResolution: 128,
    reflectionCaptureSupersample: 1,
    reflectionCaptureNearPlane: 0.05,
    reflectionCaptureLightFunctions: false,
    reflectionCaptureDiffuse: false,
    reflectionCaptureDiffuseReference: true,
  })
  assert.equal(reflectionCaptureSide({ reflectionCaptureResolution: 200 }), 128)
})
