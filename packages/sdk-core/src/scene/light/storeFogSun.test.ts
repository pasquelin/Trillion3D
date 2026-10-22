// The light the fog's volume scatters is the store's held sun (`SceneLightStore.fogSunSlot`): the
// one election the analytic fog's lobe and the volume share. Split from `store.test.ts`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createSceneLightStore } from './store.ts'
import type { SceneLight } from './contracts.ts'

const LIGHT: SceneLight = {
  id: 'l0',
  kind: 'point',
  position: [1, 2, 3],
  color: [1, 0.5, 0.25],
  intensity: 4,
  range: 10,
  castsShadow: true,
}

test('the slot of the light the fog scatters follows the store’s held sun: the brightest, then the next, none without', () => {
  const store = createSceneLightStore()
  const sun = (id: string, intensity: number, extra: Partial<SceneLight> = {}): SceneLight => ({
    id,
    kind: 'directional',
    direction: [0, -1, 0],
    color: [1, 1, 1],
    intensity,
    castsShadow: false,
    ...extra,
  })
  assert.equal(store.fogSunSlot, -1, 'no light')
  store.add({ ...LIGHT })
  assert.equal(store.fogSunSlot, -1, 'a point light is no sun')
  const dim = store.add(sun('dim', 1))
  assert.equal(store.fogSunSlot, dim)
  const bright = store.add(sun('bright', 5))
  assert.equal(store.fogSunSlot, bright, 'the brighter takes the place')
  // A light of the air's second index, or one kept out of the air, never takes it.
  store.add(sun('moon', 50, { atmosphereSunIndex: 1 }))
  store.add(sun('dark', 60, { atmosphereSun: false }))
  assert.equal(store.fogSunSlot, bright)
  // The slot is where the light is now: a removal moves the last light into the hole.
  store.remove('bright')
  assert.equal(store.fogSunSlot, store.ids.indexOf('dim'))
  store.remove('dim')
  store.remove('moon')
  store.remove('dark')
  store.remove('l0')
  assert.equal(store.fogSunSlot, -1)
})
