// The light the analytic fog's lobe scatters is the store's held sun (`SceneLightStore.fogSunSlot`);
// the directional light the volume and the translucent surfaces' cloud shade take is the forward
// one (`SceneLightStore.forwardDirectionalSlot`). Split from `store.test.ts`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { LIGHT_FIELD, baseOf } from './fields.ts'
import { createSceneLightStore } from './store.ts'
import { createForwardHeader } from './forwardLight.ts'
import { LIGHT_HEADER_FORWARD, SCENE_LIGHT_HEADER_FLOATS, type SceneLight } from './contracts.ts'
import { validateSceneAtmosphere } from '../core/atmosphere.ts'
import { ENVIRONMENT_COEFFICIENTS } from '../core/environment.ts'
import { FOG_SLOT } from '../core/fog.ts'
import { near } from '../../../../math/src/float/near.fixture.ts'

const LIGHT: SceneLight = {
  id: 'l0',
  kind: 'point',
  position: [1, 2, 3],
  color: [1, 0.5, 0.25],
  intensity: 4,
  range: 10,
  castsShadow: true,
}

test('the sun the analytic fog scatters follows the store’s held sun: the brightest, then the next, none without', () => {
  const store = createSceneLightStore()
  const sun = (
    id: string,
    intensity: number,
    direction: [number, number, number],
    extra: Partial<SceneLight> = {},
  ): SceneLight => ({
    id,
    kind: 'directional',
    direction,
    color: [1, 1, 1],
    intensity,
    castsShadow: false,
    ...extra,
  })
  const at = ENVIRONMENT_COEFFICIENTS * 4 + FOG_SLOT.sun * 4
  const fog = () => Array.from(store.environmentPacked.subarray(at, at + 3))
  store.setEnvironment({ exposure: 1, fog: {} })
  near(fog(), [0, 0, 0], 'no light')
  store.add({ ...LIGHT })
  near(fog(), [0, 0, 0], 'a point light is no sun')
  store.add(sun('dim', 1, [0, -1, 0]))
  near(fog(), [0, 1, 0], 'the one sun')
  store.add(sun('bright', 5, [-1, 0, 0]))
  near(fog(), [1, 0, 0], 'the brighter takes the place')
  // A light of the air's second index, or one kept out of the air, never takes it.
  store.add(sun('moon', 50, [0, 0, -1], { atmosphereSunIndex: 1 }))
  store.add(sun('dark', 60, [0, 0, 1], { atmosphereSun: false }))
  near(fog(), [1, 0, 0], 'the brighter still')
  store.remove('bright')
  near(fog(), [0, 1, 0], 'the next')
  store.remove('dim')
  store.remove('moon')
  store.remove('dark')
  store.remove('l0')
  near(fog(), [0, 0, 0], 'none without')
})

test('the forward directional light is the highest priority, then the greatest declared colour times intensity, the first added of equals; the buffer’s header names its rank plus one', () => {
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
  const forwardIs = (id: string | undefined, why: string) => {
    const slot = id === undefined ? -1 : store.slotOf(id)
    assert.equal(store.forwardDirectionalSlot, slot, why)
    const header = new Uint32Array(store.packed.buffer, 0, SCENE_LIGHT_HEADER_FLOATS)
    assert.equal(header[LIGHT_HEADER_FORWARD], slot + 1, `${why}: the header`)
  }
  forwardIs(undefined, 'no light')
  store.add({ ...LIGHT })
  forwardIs(undefined, 'a point light is none')
  store.add(sun('a', 2))
  store.add(sun('b', 2))
  forwardIs('a', 'equals: the first added')
  store.add(sun('c', 4, { color: [1, 0, 0] }))
  forwardIs('c', 'the greatest colour times intensity')
  // A reddened sun keeps its place: the colour compared is the declared one, not the colour the
  // air's transmittance leaves it. The light held for the air is tinted in the buffer; the other
  // directional light is not.
  store.setEnvironment({ exposure: 1, atmosphere: validateSceneAtmosphere(true) })
  store.add(sun('low', 3.5, { direction: [-1, -0.02, 0] }))
  const lit = (id: string) => {
    const at = baseOf(store.slotOf(id)) + LIGHT_FIELD.color
    const [r, g, b] = [0, 1, 2].map((c) => store.packed[at + c])
    return (
      (r * r + g * g + b * b) * store.packed[baseOf(store.slotOf(id)) + LIGHT_FIELD.intensity] ** 2
    )
  }
  assert.ok(lit('low') < lit('c'), 'the air’s tint takes the low sun under another in the buffer')
  forwardIs('low', 'and the declared colour keeps it first')
  // The priority is first: a light of 1 takes it from any of 0, whatever its colour.
  store.set('b', { forwardShadingPriority: 1 })
  forwardIs('b', 'a priority of 1')
  store.set('a', { forwardShadingPriority: 1 })
  forwardIs('a', 'equal priorities: the first added of equals')
  store.set('c', { forwardShadingPriority: 2 })
  forwardIs('c', 'a priority of 2')
  // The slot is where the light is now: a removal moves the last light into the hole, the header
  // following it.
  store.remove('a')
  forwardIs('c', 'a removal moves the last light')
  store.remove('c')
  forwardIs('b', 'the next priority')
  store.remove('b')
  forwardIs('low', 'the only one')
  store.remove('low')
  forwardIs(undefined, 'none left')
})

test('the priority of a light for the forward light is a whole number of at least 0, a directional light’s alone', () => {
  const store = createSceneLightStore()
  const sun = (forwardShadingPriority: number): SceneLight => ({
    id: 's',
    kind: 'directional',
    direction: [0, -1, 0],
    color: [1, 1, 1],
    intensity: 1,
    castsShadow: false,
    forwardShadingPriority,
  })
  for (const bad of [-1, 1.5, Number.NaN, Infinity])
    assert.throws(() => store.add(sun(bad)), /forwardShadingPriority expects a whole number/)
  assert.throws(
    () => store.add({ ...LIGHT, forwardShadingPriority: 1 }),
    /forwardShadingPriority exists only for a directional light/,
  )
  store.add(sun(3))
  assert.equal(store.light('s')?.forwardShadingPriority, 3)
})

test('the forward light’s header word is its slot plus one, 0 for none; the slots moving writes it again, the choice staying', () => {
  const sun = (id: string, intensity: number): SceneLight => ({
    id,
    kind: 'directional',
    direction: [0, -1, 0],
    color: [1, 1, 1],
    intensity,
    castsShadow: false,
  })
  const ids = ['a', 'b']
  const records = new Map([sun('a', 1), sun('b', 3)].map((light) => [light.id, light]))
  const indexOf = new Map([
    ['a', 0],
    ['b', 1],
  ])
  const header = new Uint32Array(8)
  const forward = createForwardHeader({
    ids,
    records,
    indexOf,
    rankOf: (id) => ids.indexOf(id),
    header: () => header,
  })
  assert.equal(forward.slot, 1, 'the brighter one')
  forward.changed()
  assert.equal(header[LIGHT_HEADER_FORWARD], 2)
  // The slots moved under the light (another was removed before it): the word follows, the choice does not.
  indexOf.set('b', 0)
  forward.moved()
  assert.deepEqual([forward.slot, header[LIGHT_HEADER_FORWARD]], [0, 1])
  // No directional light: none.
  ids.length = 0
  records.clear()
  indexOf.clear()
  forward.changed()
  assert.deepEqual([forward.slot, header[LIGHT_HEADER_FORWARD]], [-1, 0])
})
