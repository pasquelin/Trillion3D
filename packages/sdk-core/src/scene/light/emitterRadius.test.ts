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

test('a lamp’s tube and soft radius pass validation, and reach their lanes: zero for any light without', () => {
  const tube = validateSceneLight({
    ...lanterne(0.2),
    emitterLength: 2,
    emitterSoftRadius: 0.1,
    emitterAxis: [0, 3, 0],
  })
  assert.deepEqual(
    [tube.emitterLength, tube.emitterSoftRadius, tube.emitterAxis],
    [2, 0.1, [0, 1, 0]],
  )
  assert.equal(validateSceneLight({ ...lanterne(), emitterLength: 1 }).emitterAxis, undefined)
  for (const bad of [{ emitterLength: 0 }, { emitterLength: -1 }, { emitterLength: Number.NaN }])
    assert.throws(() => validateSceneLight({ ...lanterne(), ...bad }), /emitter length/)
  for (const soft of [0, -1, 30, Number.NaN])
    assert.throws(
      () => validateSceneLight({ ...lanterne(), emitterSoftRadius: soft }),
      /soft radius/,
    )
  assert.throws(
    () => validateSceneLight({ ...lanterne(), emitterAxis: [0, 1, 0] }),
    /only with an emitterLength/,
  )
  assert.throws(
    () => validateSceneLight({ ...lanterne(), emitterLength: 1, emitterAxis: [0, 0, 0] }),
    /zero-length/,
  )
  const sun = {
    ...lanterne(),
    kind: 'directional',
    direction: [0, -1, 0],
    position: undefined,
    range: undefined,
  } as SceneLight
  for (const field of [
    { emitterLength: 1 },
    { emitterSoftRadius: 0.1 },
    { emitterAxis: [0, 1, 0] },
  ])
    assert.throws(
      () => validateSceneLight({ ...sun, ...field } as SceneLight),
      /does not exist for a directional/,
    )
  // The lanes: the axis times half the length, then the soft radius; a light without either, or
  // another in the slot, leaves them zero.
  const store = createSceneLightStore()
  store.add(validateSceneLight({ ...lanterne(), emitterLength: 4, emitterSoftRadius: 0.5 }))
  const at = baseOf(0)
  assert.deepEqual(
    [...store.packed.slice(at + LIGHT_FIELD.halfAxis, at + LIGHT_FIELD.halfAxis + 3)],
    [0, 2, 0],
    'up, by default',
  )
  assert.equal(store.packed[at + LIGHT_FIELD.softRadius], 0.5)
  store.set('lanterne', { emitterLength: undefined, emitterSoftRadius: undefined })
  assert.deepEqual(
    [...store.packed.slice(at + LIGHT_FIELD.halfAxis, at + LIGHT_FIELD.softRadius + 1)],
    [0, 0, 0, 0],
  )
  store.set('lanterne', { emitterLength: 1, emitterAxis: [1, 0, 0] })
  assert.deepEqual(
    [...store.packed.slice(at + LIGHT_FIELD.halfAxis, at + LIGHT_FIELD.halfAxis + 3)],
    [0.5, 0, 0],
  )
})
