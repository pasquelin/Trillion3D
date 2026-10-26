import assert from 'node:assert/strict'
import test from 'node:test'
import type { SceneLight } from './contracts.ts'
import { validateSceneLight } from './validate.ts'
import { createSceneLightStore } from './store.ts'
import { baseOf, brightnessOf, LIGHT_FIELD } from './fields.ts'
import { spotAnglesOf } from './spotAngles.ts'

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

test('a lamp’s fall-off and shares and a spot’s cones pass validation and reach their lanes', () => {
  const spot = (extra: Partial<SceneLight> = {}) =>
    validateSceneLight({
      ...{ ...lanterne(), kind: 'spot', direction: [0, -1, 0], outerConeAngle: 0.8 },
      ...extra,
    })
  const lane = (light: SceneLight, field: number, count = 1) => {
    const store = createSceneLightStore()
    store.add(light)
    return [...store.packed.slice(baseOf(0) + field, baseOf(0) + field + count)]
  }
  const f = Math.fround
  // The cones: the outer one the outer angle, the inner one the inner angle, none by default (the
  // whole cone fades); a sharp spot fades across a milliradian.
  const cones = (extra?: Partial<SceneLight>) => [
    ...lane(spot(extra), LIGHT_FIELD.cosInner),
    ...lane(spot(extra), LIGHT_FIELD.cosCone),
  ]
  assert.deepEqual(cones(), [1, f(Math.cos(0.8))])
  assert.deepEqual(cones({ innerConeAngle: 0.4 }), [f(Math.cos(0.4)), f(Math.cos(0.8))])
  assert.deepEqual(cones({ innerConeAngle: 0.8 }), [f(Math.cos(0.8)), f(Math.cos(0.801))])
  assert.deepEqual(spotAnglesOf(0.5, 0.2), [0.5, 0.501], 'the outer cone past the inner one')
  const [inner, outer] = spotAnglesOf(-1, 3)
  assert.ok(inner === 0 && outer < 1.5532 && outer > 1.5522, 'held at 88.9 degrees, and its gap')
  // The fall-off: the inverse square by default (lane 0), else its exponent, 8 by default.
  const exponent = (extra?: Partial<SceneLight>) => lane(spot(extra), LIGHT_FIELD.radialExponent)[0]
  assert.deepEqual(
    [exponent(), exponent({ inverseSquared: false }), exponent({ radialExponent: 3 })],
    [0, 8, 0],
  )
  assert.equal(exponent({ inverseSquared: false, radialExponent: 3 }), 3)
  // The shares of diffuse then specular light: 1 and 1 for every kind; a rectangle's are elsewhere.
  const panel: Partial<SceneLight> = {
    kind: 'rect',
    position: [0, 3, 0],
    range: 9,
    size: [1, 1],
    right: [1, 0, 0],
  }
  const kinds: Partial<SceneLight>[] = [
    { kind: 'directional', direction: [0, -1, 0] },
    { ...panel, direction: [0, -1, 0] },
  ]
  const shares = (extra: Partial<SceneLight>) =>
    lane(
      validateSceneLight({
        id: 'k',
        color: [1, 1, 1],
        intensity: 1,
        castsShadow: false,
        ...extra,
      } as SceneLight),
      extra.kind === 'rect' ? LIGHT_FIELD.rectShares : LIGHT_FIELD.shares,
      2,
    )
  const own = { diffuseShare: 0.5, specularShare: 0.25 }
  assert.deepEqual(lane(spot(), LIGHT_FIELD.shares, 2), [1, 1])
  assert.deepEqual(lane(spot(own), LIGHT_FIELD.shares, 2), [0.5, 0.25])
  for (const kind of kinds)
    assert.deepEqual(
      [shares(kind), shares({ ...kind, ...own })],
      [
        [1, 1],
        [0.5, 0.25],
      ],
      kind.kind,
    )
  for (const bad of [{ inverseSquared: 1 }, { radialExponent: 0 }, { radialExponent: Number.NaN }])
    assert.throws(() => spot(bad as Partial<SceneLight>), /inverseSquared|radialExponent/)
  for (const bad of [{ diffuseShare: -1 }, { specularShare: 2 }, { diffuseShare: Number.NaN }])
    assert.throws(() => spot(bad), /Share expected in \[0, 1\]/)
  const refused = () => shares({ ...kinds[1], inverseSquared: false })
  assert.throws(refused, /exists only for a point or a spot/)
})

test('a unit is refused on a directional light or when unknown; an EV intensity may be 0 or under, any other 0 or over', () => {
  const lamp = { id: 'l', kind: 'point', position: [0, 0, 0], range: 5, color: [1, 1, 1] }
  const ok = (light: object) => validateSceneLight({ castsShadow: false, ...light } as SceneLight)
  assert.equal(ok(lamp).intensity, undefined, 'no intensity named, none written')
  assert.equal(ok({ ...lamp, intensityUnits: 'ev', intensity: -2 }).intensity, -2)
  assert.equal(ok({ ...lamp, intensity: 0 }).intensity, 0, 'a lamp of no light is a light')
  for (const bad of [
    { ...lamp, intensity: -0.5 },
    { ...lamp, intensity: -1, intensityUnits: 'lumens' },
    { ...lamp, intensityUnits: 'watts' },
    { id: 's', kind: 'directional', direction: [0, -1, 0], color: [1, 1, 1], intensityUnits: 'ev' },
    // Off the inverse square the unit is not read: the number is a brightness, at least 0 in any unit.
    { ...lamp, intensityUnits: 'ev', intensity: -3, inverseSquared: false },
    // A nit read without a source area would give no light at all.
    { ...lamp, intensityUnits: 'nits', intensity: 5 },
    { ...lamp, intensityUnits: 'nits' },
  ])
    assert.throws(() => ok(bad), /INVALID_SCENE_LIGHT|intensity|nits/, JSON.stringify(bad))
  // With a source, or off the inverse square, a nit lamp lights.
  assert.equal(ok({ ...lamp, intensityUnits: 'nits', emitterRadius: 0.1 }).intensityUnits, 'nits')
  const flat = { ...lamp, intensityUnits: 'nits', inverseSquared: false, intensity: 2 }
  assert.equal(brightnessOf(ok(flat)), 2)
})
