// A point, spot or rect light names the distance past which a perspective view leaves it out
// (`SceneLight.maxDrawDistance`, metres, 0 no limit): a number of 0 or more, refused on a sun, a
// change that is counted, and 0 the default reset.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createSceneLightStore } from './store.ts'
import { maxDrawDistanceOf } from './fields.ts'
import type { SceneLight } from './contracts.ts'

const LAMP: SceneLight = {
  id: 'l0',
  kind: 'point',
  position: [0, 1, 0],
  range: 8,
  color: [1, 1, 1],
  intensity: 1,
  castsShadow: false,
}

test('a draw distance is a change when it moves, none when it resets the default', () => {
  const store = createSceneLightStore()
  store.add({ ...LAMP })
  const epoch = store.epoch
  store.set('l0', { maxDrawDistance: 0 })
  assert.equal(store.epoch, epoch, 'the default reset is no change')
  store.set('l0', { maxDrawDistance: 120 })
  assert.equal(store.epoch, epoch + 1)
  assert.equal(maxDrawDistanceOf(store.light('l0')!), 120)
  assert.equal(maxDrawDistanceOf(LAMP), 0)
})

test('a negative or non-numeric draw distance, and a sun with one, are refused', () => {
  const store = createSceneLightStore()
  store.add({ ...LAMP })
  for (const bad of [-1, NaN, Infinity, '5'])
    assert.throws(() => store.set('l0', { maxDrawDistance: bad as never }), /maxDrawDistance/)
  assert.throws(
    () =>
      store.add({
        id: 'sun',
        kind: 'directional',
        direction: [0, -1, 0],
        color: [1, 1, 1],
        intensity: 1,
        castsShadow: false,
        maxDrawDistance: 10,
      }),
    /maxDrawDistance exists only for a point, a spot or a rect/,
  )
})
