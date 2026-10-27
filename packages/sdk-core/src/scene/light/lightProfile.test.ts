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
  createLightProfileBrightness,
  iesBrightnessScaleOf,
  profileBrightnessOf,
  profileLaneOf,
  profiledIntensityOf,
  profileSliceOf,
  refuseLightProfile,
  sameLightProfile,
  useIesBrightnessOf,
  validateLightProfile,
} from './lightProfile.ts'
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
  assert.equal(profiledIntensityOf(spot(named), 7, 800), 400)
  assert.equal(
    profiledIntensityOf(spot({ ...named, intensityUnits: 'ev' }), 7, 1024),
    Math.log2(512),
  )
  // A scale of 0 in EV is dark and finite, not minus infinity.
  assert.ok(
    Number.isFinite(
      profiledIntensityOf(spot({ ...named, iesBrightnessScale: 0, intensityUnits: 'ev' }), 7, 800),
    ),
  )
  // Off, no profile or no brightness known yet: the declared intensity.
  assert.equal(profiledIntensityOf(spot({ ...named, useIesBrightness: false }), 7, 800), 7)
  assert.equal(profiledIntensityOf(spot({ useIesBrightness: true }), 7, 800), 7)
  assert.equal(profiledIntensityOf(spot(named), 7, undefined), 7)
})

test('the brightness view reports what changed', () => {
  const view = createLightProfileBrightness()
  assert.equal(view.brightnessOf('p'), undefined)
  assert.equal(view.set('p', 800), true)
  assert.equal(view.set('p', 800), false)
  assert.equal(view.brightnessOf('p'), 800)
  assert.equal(profileBrightnessOf(spot({ iesProfile: 'p' }), view), 800)
  assert.equal(profileBrightnessOf(spot({ iesProfile: 'q' }), view), undefined)
  assert.equal(profileBrightnessOf(spot(), view), undefined)
})

test('two lights are the same light only with the same profile', () => {
  const base = spot({ iesProfile: 'p' })
  assert.ok(sameLightProfile(base, spot({ iesProfile: 'p' })))
  assert.ok(sameLightProfile(spot(), spot()))
  for (const other of [
    spot({ iesProfile: 'q' }),
    spot({ iesProfile: 'p', useIesBrightness: true }),
    spot({ iesProfile: 'p', iesBrightnessScale: 2 }),
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

test("a loaded profile's brightness becomes the intensity of the lights that take it", () => {
  const store = createSceneLightStore()
  store.add(
    spot({
      id: 'a',
      iesProfile: 'p',
      emitterAxis: forward,
      useIesBrightness: true,
      iesBrightnessScale: 2,
    }),
  )
  store.add(spot({ id: 'b', iesProfile: 'p', emitterAxis: forward }))
  const intensity = (slot: number) => store.packed[baseOf(slot) + LIGHT_FIELD.intensity]!
  const declared = intensity(1)
  const epoch = store.epoch
  store.setProfileBrightness('p', 400)
  assert.equal(intensity(0), Math.fround(brightnessOf(store.light('a')!, 400)))
  assert.notEqual(intensity(0), declared)
  assert.equal(intensity(1), declared, 'a light that does not take it keeps its own')
  assert.ok(store.epoch > epoch)
  const held = store.epoch
  store.setProfileBrightness('p', 400)
  assert.equal(store.epoch, held, 'the same brightness again changes nothing')
  // A light added later takes the brightness already known.
  store.add(spot({ id: 'c', iesProfile: 'p', emitterAxis: forward, useIesBrightness: true }))
  assert.equal(intensity(2), Math.fround(brightnessOf(store.light('c')!, 400)))
})
