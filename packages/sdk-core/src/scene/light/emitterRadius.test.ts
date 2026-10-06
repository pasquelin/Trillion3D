import assert from 'node:assert/strict'
import test from 'node:test'
import type { SceneLight } from './contracts.ts'
import { validateSceneLight } from './validate.ts'
import { createSceneLightStore } from './store.ts'
import { baseOf, LIGHT_FIELD } from './fields.ts'

const lanterne = (emitterRadius?: number): SceneLight => ({
  id: 'lanterne',
  kind: 'point',
  position: [0, 4.84, 0],
  range: 30,
  color: [1, 0.9, 0.7],
  intensity: 12,
  castsShadow: true,
  ...(emitterRadius === undefined ? {} : { emitterRadius }),
})

test('the emitter radius passes validation, and is accepted only in (0, range)', () => {
  assert.equal(validateSceneLight(lanterne(0.2)).emitterRadius, 0.2)
  assert.equal(validateSceneLight(lanterne()).emitterRadius, undefined)
  for (const refuse of [0, -1, 30, 45, Number.NaN])
    assert.throws(() => validateSceneLight(lanterne(refuse)), /emitter radius/)
})

test('a directional light has no envelope, and the contract refuses to lend it one', () => {
  assert.throws(
    () =>
      validateSceneLight({
        id: 'sun',
        kind: 'directional',
        direction: [0, -1, 0],
        color: [1, 1, 1],
        intensity: 3,
        castsShadow: true,
        emitterRadius: 0.2,
      }),
    /emitterRadius/,
  )
})

test("setting the emitter radius alone does stale the light's shadow map", () => {
  const store = createSceneLightStore()
  store.add(validateSceneLight(lanterne()))
  const before = store.epoch
  store.set('lanterne', { emitterRadius: 0.25 })
  // An identical mutation stales nothing (batch "idempotent mutations"); this one changes the
  // light's shadow map, so it must be seen.
  assert.notEqual(store.epoch, before)
  assert.equal(store.light('lanterne')!.emitterRadius, 0.25)
  const stable = store.epoch
  store.set('lanterne', { emitterRadius: 0.25 })
  assert.equal(store.epoch, stable)
})

test('a point radius reaches its packed shape lane and updates without changing other lights', () => {
  const store = createSceneLightStore()
  store.add(validateSceneLight(lanterne()))
  store.add(validateSceneLight({ ...lanterne(0.5), id: 'second' }))
  const lane = baseOf(0) + LIGHT_FIELD.emitterRadius
  assert.equal(store.packed[lane], 0)
  const neighbour = store.packed.slice(baseOf(1), baseOf(2))
  store.set('lanterne', { emitterRadius: 0.25 })
  assert.equal(store.packed[lane], 0.25)
  assert.deepEqual(store.packed.slice(baseOf(1), baseOf(2)), neighbour)
})
