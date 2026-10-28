// A light's profile: what a light may name, the frame it is read in, the intensity it can give, and where the store holds its slice.
import test from 'node:test'
import assert from 'node:assert/strict'
import { LIGHT_FIELD, baseOf, brightnessOf } from './fields.ts'
import {
  LIGHT_FUNCTION_ENTRIES,
  LIGHT_FUNCTION_SHIFT,
  LIGHT_PROFILE_SLICES,
  type SceneLight,
} from './contracts.ts'
import {
  profileLaneOf,
  profiledIntensityOf,
  profileSliceOf,
  refuseLightProfile,
  sameLightProfile,
  validateLightProfile,
} from './lightProfile.ts'
import { iesBrightnessScaleOf, useIesBrightnessOf } from './iesBrightness.ts'
import { createSceneLightStore } from './store.ts'
import { validateSceneLight } from './validate.ts'

const spot = (extra: Partial<SceneLight> = {}): SceneLight => ({
  id: 'lamp',
  kind: 'spot',
  position: [0, 3, 0],
  range: 10,
  color: [1, 1, 1],
  castsShadow: false,
  direction: [0, -1, 0],
  outerConeAngle: 0.6,
  ...extra,
})

/** The profile fields of `light` as validation leaves them, the direction and the axis being the validated light's. */
const validated = (light: SceneLight) => {
  const into = spot({ emitterAxis: light.emitterAxis })
  validateLightProfile(light, into)
  return into
}

const forward: [number, number, number] = [0, 0, 1]

test('a light with no profile names none of its fields', () => {
  assert.equal(validated(spot()).iesProfile, undefined)
  for (const extra of [{ useIesBrightness: true }, { iesBrightnessScale: 2 }])
    assert.throws(
      () => validateLightProfile(spot(extra), spot()),
      /exists only beside an iesProfile/,
    )
})

test('a profile keeps its id, its switch and its scale', () => {
  const light = validated(
    spot({
      iesProfile: 'light-profile-0123.bin',
      useIesBrightness: true,
      iesBrightnessScale: 2,
      emitterAxis: forward,
    }),
  )
  assert.equal(light.iesProfile, 'light-profile-0123.bin')
  assert.equal(light.useIesBrightness, true)
  assert.equal(light.iesBrightnessScale, 2)
  assert.equal(useIesBrightnessOf(spot()), false)
  assert.equal(iesBrightnessScaleOf(spot()), 1)
})

test('a profile needs the axis its angle runs round, not parallel to the direction, and refuses what is not a profile', () => {
  const named = { iesProfile: 'p' }
  assert.throws(() => validateLightProfile(spot(named), spot()), /requires an emitterAxis/)
  assert.throws(
    () => validateLightProfile(spot(named), spot({ emitterAxis: [0, 1, 0] })),
    /parallel/,
  )
  assert.throws(
    () =>
      validateLightProfile(spot(named), {
        ...spot({ emitterAxis: forward }),
        direction: undefined,
      }),
    /requires the light direction/,
  )
  const axis = { emitterAxis: forward }
  for (const bad of [{ iesProfile: '' }, { iesProfile: 3 as unknown as string }])
    assert.throws(() => validateLightProfile(spot(bad), spot(axis)), /profile id/)
  assert.throws(
    () => validateLightProfile(spot({ ...named, iesBrightnessScale: -1 }), spot(axis)),
    />= 0/,
  )
  assert.throws(
    () =>
      validateLightProfile(
        spot({ ...named, useIesBrightness: 1 as unknown as boolean }),
        spot(axis),
      ),
    /boolean/,
  )
})

test('the axis of a profile is allowed without a tube, and without a profile it needs one', () => {
  const light = validateSceneLight(spot({ iesProfile: 'p', emitterAxis: [0, 0, 3] }))
  assert.deepEqual(light.emitterAxis, [0, 0, 1])
  assert.equal(light.emitterLength, undefined)
  assert.throws(
    () => validateSceneLight(spot({ emitterAxis: forward })),
    /emitterLength or an iesProfile/,
  )
})

test('a sun and a rect have no profile', () => {
  for (const kind of ['directional', 'rect'] as const)
    assert.throws(() => refuseLightProfile(spot({ kind, iesProfile: 'p' })), /iesProfile/)
  refuseLightProfile(spot())
  assert.throws(
    () =>
      validateSceneLight({
        id: 'sun',
        kind: 'directional',
        direction: [0, -1, 0],
        color: [1, 1, 1],
        castsShadow: false,
        iesProfile: 'p',
      }),
    /iesProfile/,
  )
})

test('the intensity is the profile brightness times the scale, in EV its logarithm', () => {
  const named = { iesProfile: 'p', useIesBrightness: true, iesBrightnessScale: 0.5 }
  assert.equal(profiledIntensityOf(spot({ ...named, iesBrightness: 800 }), 7), 400)
  assert.equal(
    profiledIntensityOf(spot({ ...named, iesBrightness: 1024, intensityUnits: 'ev' }), 7),
    Math.log2(512),
  )
  // A scale of 0 in EV is dark and finite, not minus infinity.
  assert.ok(
    Number.isFinite(
      profiledIntensityOf(
        spot({ ...named, iesBrightness: 800, iesBrightnessScale: 0, intensityUnits: 'ev' }),
        7,
      ),
    ),
  )
  // Off, no profile or no brightness carried: the declared intensity.
  assert.equal(
    profiledIntensityOf(spot({ ...named, iesBrightness: 800, useIesBrightness: false }), 7),
    7,
  )
  assert.equal(profiledIntensityOf(spot({ useIesBrightness: true, iesBrightness: 800 }), 7), 7)
  assert.equal(profiledIntensityOf(spot(named), 7), 7)
})

test('the brightness of a profile is a finite number above 0, and only beside a profile', () => {
  const named = { iesProfile: 'p', emitterAxis: forward }
  assert.equal(validateSceneLight(spot({ ...named, iesBrightness: 120 })).iesBrightness, 120)
  for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY])
    assert.throws(
      () => validateSceneLight(spot({ ...named, iesBrightness: bad })),
      /iesBrightness/,
      String(bad),
    )
  assert.throws(() => validateSceneLight(spot({ iesBrightness: 120 })), /iesBrightness/)
})

test('two lights are the same light only with the same profile', () => {
  const base = spot({ iesProfile: 'p' })
  assert.ok(sameLightProfile(base, spot({ iesProfile: 'p' })))
  assert.ok(sameLightProfile(spot(), spot()))
  for (const other of [
    spot({ iesProfile: 'q' }),
    spot({ iesProfile: 'p', useIesBrightness: true }),
    spot({ iesProfile: 'p', iesBrightnessScale: 2 }),
    spot({ iesProfile: 'p', iesBrightness: 90 }),
    spot(),
  ])
    assert.ok(!sameLightProfile(base, other))
})

test('the lane holds the slice plus one', () => {
  assert.equal(profileLaneOf(-1), 0)
  assert.equal(profileSliceOf(profileLaneOf(LIGHT_PROFILE_SLICES - 1)), LIGHT_PROFILE_SLICES - 1)
})

/** The kind word of slot `slot` of `store`, the bits of its float. */
const kindWord = (store: ReturnType<typeof createSceneLightStore>, slot: number) =>
  new Uint32Array(store.packed.buffer)[baseOf(slot) + LIGHT_FIELD.kind]!

test("the store holds a light's slice in its kind word, beside the light function, and carries it where the light moves", () => {
  const store = createSceneLightStore()
  const named = { iesProfile: 'p', emitterAxis: forward }
  store.add(spot({ id: 'a', ...named }))
  store.add(spot({ id: 'b', ...named, iesProfile: 'q' }))
  assert.equal(store.profiled, 2)
  assert.equal(store.lightProfileSliceOf(0), -1, 'no slice until the atlas gives one')
  store.assignLightProfile(0, 5)
  store.assignLightProfile(1, LIGHT_PROFILE_SLICES - 1)
  store.assignLightFunction(0, 3)
  assert.equal(store.lightProfileSliceOf(0), 5)
  assert.equal(store.lightFunctionOf(0), 3)
  assert.equal((kindWord(store, 0) >>> LIGHT_FUNCTION_SHIFT) % LIGHT_FUNCTION_ENTRIES, 3)
  // The first light goes: the last takes its slot and its slice.
  const epoch = store.profileEpoch
  store.remove('a')
  assert.ok(store.profileEpoch > epoch)
  assert.equal(store.profiled, 1)
  assert.equal(store.lightProfileSliceOf(0), LIGHT_PROFILE_SLICES - 1)
  // Another profile starts without a slice; the same profile keeps it.
  store.set('b', { castsShadow: true })
  assert.equal(store.lightProfileSliceOf(0), LIGHT_PROFILE_SLICES - 1)
  const settled = store.profileEpoch
  store.set('b', { iesProfile: 'r' })
  assert.ok(store.profileEpoch > settled)
  assert.equal(store.lightProfileSliceOf(0), -1)
  store.set('b', { iesProfile: undefined, emitterAxis: undefined })
  assert.equal(store.profiled, 0)
})

test('a point light with a profile writes the direction its profile is read along', () => {
  const store = createSceneLightStore()
  store.add({
    id: 'bulb',
    kind: 'point',
    position: [0, 3, 0],
    range: 10,
    color: [1, 1, 1],
    castsShadow: false,
    direction: [0, 0, -1],
    iesProfile: 'p',
    emitterAxis: [1, 0, 0],
  })
  const at = baseOf(store.slotOf('bulb'))
  assert.deepEqual(
    [...store.packed.slice(at + LIGHT_FIELD.direction, at + LIGHT_FIELD.direction + 3)],
    [0, 0, -1],
  )
  // The axis lane holds the profile's unit axis; the light has no tube.
  assert.deepEqual(
    [...store.packed.slice(at + LIGHT_FIELD.emitterAxis, at + LIGHT_FIELD.emitterAxis + 3)],
    [1, 0, 0],
    'the axis lane holds the profile’s axis',
  )
  assert.equal(store.packed[at + LIGHT_FIELD.tubeHalfLength], 0, 'and no tube')
})

test("a profile's brightness is the intensity of the lights that take it", () => {
  const store = createSceneLightStore()
  const named = { iesProfile: 'p', emitterAxis: forward, iesBrightness: 400 }
  store.add(spot({ id: 'a', ...named, useIesBrightness: true, iesBrightnessScale: 2 }))
  store.add(spot({ id: 'b', ...named }))
  const intensity = (slot: number) => store.packed[baseOf(slot) + LIGHT_FIELD.intensity]!
  assert.equal(intensity(0), Math.fround(brightnessOf(store.light('a')!)))
  assert.notEqual(intensity(0), intensity(1), 'the scale and the brightness move the intensity')
  assert.equal(
    intensity(1),
    Math.fround(brightnessOf(store.light('b')!)),
    'a light that does not take it keeps its own',
  )
})
