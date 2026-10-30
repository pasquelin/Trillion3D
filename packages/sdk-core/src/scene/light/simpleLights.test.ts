import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSceneLightStore } from './store.ts'
import { LIGHT_FIELD, SIMPLE_WORD } from './fields.ts'
import { LIGHT_KIND, LIGHT_KIND_SPAN, SCENE_LIGHT_FLOATS } from './contracts.ts'
import { LIGHT } from './store.fixture.ts'
import { NO_CONTACT_SHADOW_VIEW } from './contactShadowView.ts'
import type { SimpleLightEntry } from './simpleLights.ts'

const ENTRY: SimpleLightEntry = { position: [1, 2, 3], radius: 5, color: [1, 0.5, 0.25] }

test('simple lights are point lights after the store, and move none of its epochs', () => {
  const store = createSceneLightStore()
  store.add(LIGHT)
  const { epoch, transportEpoch } = store
  store.setSimpleLights([ENTRY])
  assert.equal(store.simple.count, 1)
  assert.equal(store.count, 1)
  assert.equal(store.epoch, epoch)
  assert.equal(store.transportEpoch, transportEpoch)
  const p = store.simple.packed
  assert.deepEqual([...p.subarray(0, 3)], [1, 2, 3])
  assert.equal(p[LIGHT_FIELD.range], 5)
  assert.equal(new Uint32Array(p.buffer)[LIGHT_FIELD.kind] % LIGHT_KIND_SPAN, LIGHT_KIND.point)
  // It holds no shadow map: no slice, like a scene light that has none.
  assert.equal(p[LIGHT_FIELD.shadowSlice], -1)
  assert.equal(p[LIGHT_FIELD.radialExponent], 0)
  assert.equal(p[LIGHT_FIELD.shares], 1)
  assert.equal(p[LIGHT_FIELD.fogScattering], 0)
  assert.ok(Math.abs(p[LIGHT_FIELD.intensity] - 1e-4) < 1e-9)
})

test('the exponent, the scales and the fog share are kept; scales above 1 are allowed', () => {
  const store = createSceneLightStore()
  store.setSimpleLights([
    {
      ...ENTRY,
      exponent: 2,
      diffuseScale: 3,
      specularScale: 4,
      volumetricScatteringIntensity: 0.5,
    },
  ])
  const p = store.simple.packed
  assert.equal(p[LIGHT_FIELD.radialExponent], 2)
  assert.equal(p[LIGHT_FIELD.intensity], 1)
  assert.equal(p[LIGHT_FIELD.shares], 3)
  assert.equal(p[LIGHT_FIELD.shares + 1], 4)
  assert.equal(p[LIGHT_FIELD.fogScattering], 0.5)
})

test('lights that light nothing are left out, and a scene of simple lights alone is lit', () => {
  const store = createSceneLightStore()
  assert.equal(store.unlit, true)
  store.setSimpleLights([{ ...ENTRY, radius: 0, color: [0, 0, 0] }])
  assert.equal(store.simple.count, 0)
  store.setSimpleLights([ENTRY])
  assert.equal(store.unlit, false)
})

test('the setting takes them away; the buffer room grows', () => {
  const store = createSceneLightStore()
  store.setSimpleLights(Array.from({ length: 20 }, () => ENTRY))
  assert.equal(store.simple.count, 20)
  assert.ok(store.simple.capacity >= 20)
  assert.ok(store.simple.packed.length >= 20 * SCENE_LIGHT_FLOATS)
  const before = store.simple.epoch
  store.simple.configure(false, true)
  assert.equal(store.simple.count, 0)
  assert.ok(store.simple.epoch > before)
})

test('invalid entries are refused', () => {
  const store = createSceneLightStore()
  assert.throws(() => store.setSimpleLights([{ ...ENTRY, radius: -1 } as never]))
  assert.throws(() => store.setSimpleLights([{ ...ENTRY, color: [1, NaN, 0] } as never]))
  assert.throws(() => store.setSimpleLights([{ ...ENTRY, inverseExposureBlend: 2 } as never]))
})

test('the lanes are written again when a view they are folded with changes; the room is 0 until lights are handed', () => {
  const store = createSceneLightStore()
  assert.equal(store.simple.capacity, 0)
  store.setSimpleLights([ENTRY])
  assert.ok(store.simple.capacity >= 1)
  const before = store.simple.epoch
  assert.equal(store.simple.epoch, before)
  store.setContactShadowView({ ...NO_CONTACT_SHADOW_VIEW, contactShadowOverrideLength: 0.5 })
  const after = store.simple.epoch
  assert.ok(after > before)
  assert.equal(store.simple.epoch, after)
  store.setShadowView({ dynamicShadows: false })
  assert.ok(store.simple.epoch > after)
})

const wordOf = (store: ReturnType<typeof createSceneLightStore>, slot: number) =>
  store.simple.packed[slot * SCENE_LIGHT_FLOATS + LIGHT_FIELD.simpleWord]!

test('the word holds which pass lights the light, its sampled shadow and its translucency, as the float of its value', () => {
  const store = createSceneLightStore()
  store.setSimpleLights([
    ENTRY,
    { ...ENTRY, allowSampledLighting: true, sampledCastsShadow: true, affectsTranslucency: true },
    // The shadow ray belongs to the sampled lighting: a light the classic pass lights holds none.
    { ...ENTRY, sampledCastsShadow: true },
  ])
  assert.equal(wordOf(store, 0), SIMPLE_WORD.classic)
  assert.equal(wordOf(store, 1), SIMPLE_WORD.sampledShadow | SIMPLE_WORD.translucency)
  assert.equal(wordOf(store, 2), SIMPLE_WORD.classic)
  store.simple.configure(true, true, 2)
  assert.equal(wordOf(store, 2) & SIMPLE_WORD.sampledShadow, SIMPLE_WORD.sampledShadow)
  assert.ok(Number.isFinite(store.simple.packed[LIGHT_FIELD.simpleWord]))
})

test('a light is followed by its identity, which the store gives back for each slot', () => {
  const store = createSceneLightStore()
  const light = (local: number): SimpleLightEntry => ({
    ...ENTRY,
    lightId: { localId: local, sourcePrimitiveId: 7 },
  })
  store.setSimpleLights([light(0), light(1), { ...ENTRY }])
  assert.deepEqual(
    [0, 1, 2].map((slot) => store.simple.identityOf(slot)),
    ['7:0', '7:1', undefined],
  )
  // The settle step is gone: the word holds no rank, and a new list moves the epoch alone.
  assert.equal(wordOf(store, 0), SIMPLE_WORD.classic)
})

test('a list equal to the held one changes nothing; the empty list too', () => {
  const store = createSceneLightStore()
  assert.equal(store.setSimpleLights([]), false)
  assert.equal(store.setSimpleLights([ENTRY]), true)
  const { epoch } = store.simple
  const again: SimpleLightEntry = { ...ENTRY, position: [1, 2, 3], color: [1, 0.5, 0.25] }
  assert.equal(store.setSimpleLights([again]), false)
  assert.equal(store.simple.epoch, epoch)
  // A light that lights nothing is no change either.
  assert.equal(store.setSimpleLights([again, { ...ENTRY, radius: 0, color: [0, 0, 0] }]), false)
  assert.equal(store.setSimpleLights([{ ...again, radius: 6 }]), true)
  assert.ok(store.simple.epoch > epoch)
})

test('the classic count is the lights only the classic pass lights', () => {
  const store = createSceneLightStore()
  store.setSimpleLights([ENTRY, { ...ENTRY, allowSampledLighting: true }])
  assert.equal(store.simple.classicCount, 1)
  store.simple.configure(true, true, 2)
  assert.equal(store.simple.classicCount, 0)
  store.simple.configure(false, true, 2)
  assert.equal(store.simple.classicCount, 0)
})

test('the views the lights are folded with move the epoch when they change, and only then', () => {
  const store = createSceneLightStore()
  store.setSimpleLights([ENTRY])
  const { epoch } = store.simple
  assert.equal(store.simple.epoch, epoch, 'reading the epoch changes nothing')
  store.setContactShadowView({ ...NO_CONTACT_SHADOW_VIEW })
  assert.equal(store.simple.epoch, epoch)
  store.setContactShadowView({ ...NO_CONTACT_SHADOW_VIEW, contactShadowOverrideLength: 0.5 })
  assert.ok(store.simple.epoch > epoch)
})

test('duplicate identities and entries that are no objects are refused', () => {
  const store = createSceneLightStore()
  const id = { localId: 1, sourcePrimitiveId: 2 }
  assert.throws(() =>
    store.setSimpleLights([
      { ...ENTRY, lightId: id },
      { ...ENTRY, lightId: { ...id } },
    ]),
  )
  assert.throws(() => store.setSimpleLights([null as never]))
})

test('invalid identities are refused', () => {
  const store = createSceneLightStore()
  assert.throws(() =>
    store.setSimpleLights([{ ...ENTRY, lightId: { localId: -1, sourcePrimitiveId: 0 } }]),
  )
  assert.throws(() =>
    store.setSimpleLights([{ ...ENTRY, lightId: { localId: 0.5, sourcePrimitiveId: 0 } }]),
  )
  assert.throws(() => store.setSimpleLights([{ ...ENTRY, sampledCastsShadow: 1 as never }]))
})
