// A light's contact shadows and its indirect lighting factor, from the record to the GPU's seventh
// `vec4`, folded on the CPU with the view's settings as the reference builds a light's data: the length
// negative in metres and doubled in screen units, each override that is 0 or more in place of the
// light's own, no ray with the switch off; the lanes are written again when the view moves; the store
// counts the lights that cast a ray of their own.
import test from 'node:test'
import assert from 'node:assert/strict'
import { LIGHT_FIELD, baseOf } from './fields.ts'
import { createSceneLightStore } from './store.ts'
import { LIGHT_KIND, type SceneLight } from './contracts.ts'
import { NO_CONTACT_SHADOW_VIEW, type ContactShadowView } from './contactShadowView.ts'
import { NO_LIGHT_SHADOW_VIEW } from './shadowedBits.ts'
import { contactShadowOfLight } from './lightContactShadow.ts'
import { cloneSceneLight } from './clone.ts'

const LAMP: SceneLight = {
  id: 'lamp',
  kind: 'point',
  position: [0, 2, 0],
  color: [1, 1, 1],
  intensity: 5,
  range: 10,
  castsShadow: true,
}

type Store = ReturnType<typeof createSceneLightStore>
const lanes = (store: Store, id: string) => {
  const at = baseOf(store.slotOf(id)) + LIGHT_FIELD.contactGi
  return [...store.packed.slice(at, at + 4)]
}
const view = (changes: Partial<ContactShadowView>): ContactShadowView => ({
  ...NO_CONTACT_SHADOW_VIEW,
  ...changes,
})

test('a light that names none casts no ray: length 0, casting 1, non-casting 0, indirect 1', () => {
  const store = createSceneLightStore()
  store.add({ ...LAMP })
  assert.deepEqual(lanes(store, 'lamp'), [0, 1, 0, 1])
  assert.equal(store.contacts, 0)
})

test('a screen length is doubled, a length in metres is negative and not', () => {
  const store = createSceneLightStore()
  store.add({
    ...LAMP,
    contactShadowLength: 0.05,
    contactShadowCastingIntensity: 0.75,
    contactShadowNonCastingIntensity: 0.25,
    indirectLightingIntensity: 2,
  })
  assert.deepEqual(lanes(store, 'lamp'), [Math.fround(0.1), 0.75, 0.25, 2])
  store.set('lamp', { contactShadowLengthInWorldSpace: true })
  assert.deepEqual(lanes(store, 'lamp'), [Math.fround(-0.05), 0.75, 0.25, 2])
  assert.equal(store.kindOf(store.slotOf('lamp')), LIGHT_KIND.point, 'the kind word is untouched')
  store.add({ ...LAMP, id: 'metres', contactShadowLengthInWorldSpace: true })
  assert.equal(Object.is(lanes(store, 'metres')[0], 0), true, 'no length in metres is 0, not −0')
})

test('the view folds the lights’ lanes: the switch, each override, a length with its own unit', () => {
  const store = createSceneLightStore()
  store.add({ ...LAMP, contactShadowLength: 0.05, contactShadowCastingIntensity: 0.5 })
  const epoch = store.epoch
  store.setContactShadowView(view({ contactShadows: false }))
  assert.deepEqual(lanes(store, 'lamp').slice(0, 3), [0, 1, 0], 'switched off: no ray')
  assert.equal(store.contacts, 0)
  assert.equal(store.epoch, epoch + 1, 'the lanes are published')
  store.setContactShadowView(view({ contactShadows: false }))
  assert.equal(store.epoch, epoch + 1, 'the same view publishes nothing')
  store.setContactShadowView(view({ contactShadowOverrideLength: 0.1 }))
  assert.deepEqual(lanes(store, 'lamp').slice(0, 3), [Math.fround(0.2), 0.5, 0])
  store.setContactShadowView(
    view({
      contactShadowOverrideLength: 0.3,
      contactShadowOverrideLengthInWorldSpace: true,
    }),
  )
  assert.deepEqual(
    lanes(store, 'lamp').slice(0, 3),
    [Math.fround(-0.3), 0.5, 0],
    'the unit follows',
  )
  store.setContactShadowView(view({ contactShadowOverrideLength: 0 }))
  assert.equal(lanes(store, 'lamp')[0], 0, 'an override of 0 takes the lights’ rays away')
  assert.equal(store.contacts, 0)
  store.setContactShadowView(
    view({
      contactShadowOverrideCastingIntensity: 0.25,
      contactShadowOverrideNonCastingIntensity: 0.75,
    }),
  )
  assert.deepEqual(lanes(store, 'lamp').slice(0, 3), [Math.fround(0.1), 0.25, 0.75])
  store.setContactShadowView(NO_CONTACT_SHADOW_VIEW)
  assert.deepEqual(lanes(store, 'lamp').slice(0, 3), [Math.fround(0.1), 0.5, 0], 'back to its own')
  // A light added after the fold is folded as the others are.
  store.setContactShadowView(view({ contactShadowOverrideLength: 0.1 }))
  store.add({ ...LAMP, id: 'later' })
  assert.equal(lanes(store, 'later')[0], Math.fround(0.2))
})

test('an intensity override above 1 is held to 1: the reference’s `1 − intensity` would light negatively', () => {
  const store = createSceneLightStore()
  store.add({ ...LAMP, contactShadowLength: 0.05 })
  store.setContactShadowView(
    view({
      contactShadowOverrideCastingIntensity: 4,
      contactShadowOverrideNonCastingIntensity: 1.5,
    }),
  )
  assert.deepEqual(lanes(store, 'lamp').slice(0, 3), [Math.fround(0.1), 1, 1])
  store.setContactShadowView(view({ contactShadowOverrideCastingIntensity: 0.5 }))
  assert.deepEqual(
    lanes(store, 'lamp').slice(0, 3),
    [Math.fround(0.1), 0.5, 0],
    'below 1 it is kept',
  )
})

test('the store counts the lights that cast a shadow and a ray of their own, under the view', () => {
  const store = createSceneLightStore()
  store.add({ ...LAMP, contactShadowLength: 0.02 })
  store.add({ ...LAMP, id: 'dark', castsShadow: false, contactShadowLength: 0.02 })
  store.add({ ...LAMP, id: 'plain' })
  assert.equal(store.contacts, 1, 'a light that casts no shadow casts no ray')
  store.setContactShadowView(view({ contactShadowOverrideLength: 0.1 }))
  assert.equal(store.contacts, 2, 'the override reaches every light that casts a shadow')
  store.remove('plain')
  assert.equal(store.contacts, 1)
  store.setContactShadowView(view({ contactShadows: false }))
  assert.equal(store.contacts, 0)
})

test('at shadow quality 0 no light has the dynamic shadow bit: none casts a ray of its own, the lanes stay', () => {
  const store = createSceneLightStore()
  store.add({ ...LAMP, contactShadowLength: 0.02 })
  assert.equal(store.contacts, 1)
  const lane = lanes(store, 'lamp').slice(0, 3)
  const epoch = store.epoch
  store.setShadowView({ dynamicShadows: false })
  assert.equal(store.contacts, 0)
  assert.equal(store.epoch, epoch + 1, 'the change is published')
  assert.deepEqual(lanes(store, 'lamp').slice(0, 3), lane, 'the lights’ own numbers are the same')
  store.setShadowView({ dynamicShadows: false })
  assert.equal(store.epoch, epoch + 1, 'the same view publishes nothing')
  store.setShadowView(NO_LIGHT_SHADOW_VIEW)
  assert.equal(store.contacts, 1)
})

test('a ray that cannot darken is none: both intensities 0 give a length of 0 and no count', () => {
  const store = createSceneLightStore()
  store.add({ ...LAMP, contactShadowLength: 0.05, contactShadowCastingIntensity: 0 })
  assert.deepEqual(lanes(store, 'lamp'), [0, 0, 0, 1])
  assert.equal(store.contacts, 0)
  store.set('lamp', { contactShadowNonCastingIntensity: 0.5 })
  assert.deepEqual(lanes(store, 'lamp'), [Math.fround(0.1), 0, 0.5, 1])
  assert.equal(store.contacts, 1)
  store.setContactShadowView(view({ contactShadowOverrideNonCastingIntensity: 0 }))
  assert.equal(lanes(store, 'lamp')[0], 0, 'the view’s intensities are the ones that count')
  assert.equal(store.contacts, 0)
})

test('a change of any of the five publishes the lanes, and stales no shadow page of the light', () => {
  const store = createSceneLightStore()
  const slot = store.add({ ...LAMP, contactShadowLength: 0.05 })
  const epoch = store.epoch,
    revision = store.revision[slot]
  store.set('lamp', { contactShadowLength: 0.05 })
  assert.equal(store.epoch, epoch)
  assert.equal(store.revision[slot], revision)
  for (const patch of [
    { contactShadowLength: 0.06 },
    { contactShadowLengthInWorldSpace: true },
    { contactShadowCastingIntensity: 0.5 },
    { contactShadowNonCastingIntensity: 0.5 },
    { indirectLightingIntensity: 0.5 },
  ] satisfies Partial<SceneLight>[]) {
    const before = store.epoch
    store.set('lamp', patch)
    assert.equal(store.epoch, before + 1, JSON.stringify(patch))
    assert.equal(store.revision[slot], revision, `${JSON.stringify(patch)} keeps the revision`)
  }
})

test('every kind may name them, and a rule’s refusal names the light', () => {
  const store = createSceneLightStore()
  store.add({
    id: 'sun',
    kind: 'directional',
    direction: [0, -1, 0],
    color: [1, 1, 1],
    intensity: 1,
    castsShadow: true,
    contactShadowLength: 0.02,
  })
  assert.deepEqual(lanes(store, 'sun'), [Math.fround(0.04), 1, 0, 1])
  assert.equal(store.contacts, 1)
  const refuses = (patch: Partial<SceneLight>, words: RegExp) =>
    assert.throws(() => store.add({ ...LAMP, id: 'bad', ...patch }), words)
  refuses({ contactShadowLength: -1 }, /bad: .*contactShadowLength.*at least 0/)
  refuses({ contactShadowCastingIntensity: 2 }, /bad: .*from 0 to 1/)
  refuses({ indirectLightingIntensity: -0.5 }, /bad: .*indirectLightingIntensity.*at least 0/)
  refuses({ contactShadowLengthInWorldSpace: 1 as never }, /bad: .*true or false/)
})

test('a light that names none shares the one frozen defaults, and a copy keeps what was named', () => {
  const first = contactShadowOfLight({ ...LAMP })
  assert.equal(first, contactShadowOfLight({ ...LAMP, id: 'other' }))
  assert.ok(Object.isFrozen(first))
  assert.deepEqual(first, {
    contactShadowLength: 0,
    contactShadowLengthInWorldSpace: false,
    contactShadowCastingIntensity: 1,
    contactShadowNonCastingIntensity: 0,
    indirectLightingIntensity: 1,
  })
  assert.equal(cloneSceneLight({ ...LAMP, contactShadowLength: 0.1 }).contactShadowLength, 0.1)
})
