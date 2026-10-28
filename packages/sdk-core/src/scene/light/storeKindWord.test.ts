// The kind word of a light: its rank, flags, channels, shadowed value and payload bits, as the store packs them.
import test from 'node:test'
import assert from 'node:assert/strict'
import { LIGHT_FIELD, baseOf, kindWordOf } from './fields.ts'
import { createSceneLightStore } from './store.ts'
import { addLight, assignDrawn, createLightTable, removeLight } from './storeTable.ts'
import {
  LIGHT_CHANNELS_SHIFT,
  LIGHT_FLAG,
  LIGHT_FUNCTION_BITS,
  LIGHT_FUNCTION_ENTRIES,
  LIGHT_FUNCTION_SHIFT,
  LIGHT_KIND,
  LIGHT_KIND_MARKER,
  LIGHT_KIND_SPAN,
  LIGHT_PAYLOAD_BITS,
  LIGHT_PAYLOAD_MASK,
  LIGHT_PROFILE_BITS,
  LIGHT_PROFILE_SHIFT,
  LIGHT_PROFILE_SLICES,
  LIGHT_SHADOWED,
  LIGHT_SHADOWED_BITS,
  LIGHT_SHADOWED_MASK,
  LIGHT_SHADOWED_SHIFT,
  LIGHT_UNDRAWN_SHIFT,
  type SceneLight,
} from './contracts.ts'
import { LIGHTING_CHANNEL_COUNT } from '../../contracts/lightingChannelsAbi.ts'
import { NO_LIGHT_SHADOW_VIEW } from './shadowedBits.ts'
import { kindWord, rankAndFlags, LIGHT } from './store.fixture.ts'

test('a light’s kind word holds its shadowed bits as the reference gives them: 3 casting, 1 casting without the dynamic shadows or wearing a function with no slot, else 0', () => {
  const { none, static: staticBits, dynamic } = LIGHT_SHADOWED
  const store = createSceneLightStore()
  const bits = (id: string) => (kindWord(store, id) >>> LIGHT_SHADOWED_SHIFT) & dynamic
  store.add({ ...LIGHT, id: 'casts' })
  store.add({ ...LIGHT, id: 'plain', castsShadow: false })
  store.add({ ...LIGHT, id: 'worn', castsShadow: false, lightFunction: 'stripes' })
  assert.deepEqual([bits('casts'), bits('plain'), bits('worn')], [dynamic, none, staticBits])
  assert.equal(store.kindOf(store.slotOf('worn')), LIGHT_KIND.point, 'the rank is kept')
  const slot = store.slotOf('worn')
  store.assignLightFunction(slot, 3)
  assert.equal(bits('worn'), none, 'a slot clears the bit')
  assert.equal(store.lightFunctionOf(slot), 3)
  store.set('worn', { intensity: 5 })
  assert.equal(bits('worn'), none, 'a write of the light keeps the slot')
  store.assignLightFunction(slot, 0)
  assert.equal(bits('worn'), staticBits, 'no slot again: the bit is back')
  // Without the dynamic shadows a light that casts still has the static bit.
  store.setShadowView({ dynamicShadows: false })
  assert.deepEqual([bits('casts'), bits('plain'), bits('worn')], [staticBits, none, staticBits])
  store.setShadowView(NO_LIGHT_SHADOW_VIEW)
  assert.deepEqual([bits('casts'), bits('plain'), bits('worn')], [dynamic, none, staticBits])
})

test('the kind word’s parts each sit above the one below: the rank, the flags, the channels stored, the shadowed value, the profile, the undrawn bit, the light function’s index, then the marker', () => {
  const flags = Object.values(LIGHT_FLAG)
  assert.deepEqual(
    flags,
    flags.map((_, k) => LIGHT_KIND_SPAN * 2 ** k),
    'one bit a flag, above the rank',
  )
  assert.equal(
    2 ** LIGHT_CHANNELS_SHIFT,
    2 * Math.max(...flags),
    'the channels sit above the flags',
  )
  assert.equal(LIGHT_SHADOWED_SHIFT, LIGHT_CHANNELS_SHIFT + LIGHTING_CHANNEL_COUNT)
  assert.equal(
    LIGHT_SHADOWED_MASK,
    LIGHT_SHADOWED.dynamic,
    'the mask holds the greatest shadowed value',
  )
  assert.equal(
    LIGHT_PROFILE_SHIFT,
    LIGHT_SHADOWED_SHIFT + LIGHT_SHADOWED_BITS,
    'the profile sits above the shadowed value',
  )
  assert.equal(
    LIGHT_UNDRAWN_SHIFT,
    LIGHT_PROFILE_SHIFT + LIGHT_PROFILE_BITS,
    'the undrawn bit sits above the profile',
  )
  assert.equal(
    LIGHT_FUNCTION_SHIFT,
    LIGHT_UNDRAWN_SHIFT + 1,
    'the index sits above the undrawn bit',
  )
  assert.equal(
    LIGHT_FUNCTION_SHIFT + LIGHT_FUNCTION_BITS,
    LIGHT_PAYLOAD_BITS,
    'the index fills the payload up to the marker',
  )
  assert.ok(
    LIGHT_PROFILE_SLICES < 2 ** LIGHT_PROFILE_BITS,
    'the slice plus one of the last profile fits its bits',
  )
})

test('the kind word’s payload fills bits 0 to 22 and never reaches bit 23, which is the constant marker: the lane is always a normal, finite, positive float', () => {
  // The budget: 2 bits of rank, one a flag, the channels, the shadowed value, the profile, the undrawn bit, the function index.
  const budget =
    Math.log2(LIGHT_KIND_SPAN) +
    Object.keys(LIGHT_FLAG).length +
    LIGHTING_CHANNEL_COUNT +
    LIGHT_SHADOWED_BITS +
    LIGHT_PROFILE_BITS +
    1 +
    LIGHT_FUNCTION_BITS
  assert.equal(budget, LIGHT_PAYLOAD_BITS, '2 + 3 + 3 + 2 + 6 + 1 + 6 = 23')
  assert.equal(LIGHT_KIND_MARKER, 2 ** LIGHT_PAYLOAD_BITS)
  const floatOf = (word: number) => new Float32Array(new Uint32Array([word]).buffer)[0]!
  // Nothing set: the marker alone, the least normal float.
  const bare = kindWordOf({ ...LIGHT, castsShadow: false }, NO_LIGHT_SHADOW_VIEW, 0)
  assert.equal(bare, LIGHT_KIND_MARKER + LIGHT_KIND.point)
  assert.ok(floatOf(bare) >= 2 ** -126, 'a word with no part set is not a subnormal')
  // Every part at its greatest: the payload is all ones to bit 22, the marker the only bit above.
  const full = kindWordOf(
    {
      ...LIGHT,
      kind: 'rect',
      castsShadow: true,
      shadowsFog: true,
      transmission: true,
      mobility: 'movable',
      lightingChannels: { channel0: false, channel1: true, channel2: true },
    },
    NO_LIGHT_SHADOW_VIEW,
    LIGHT_FUNCTION_ENTRIES - 1,
    2 ** LIGHT_PROFILE_BITS - 1,
  )
  const table = createLightTable()
  addLight(table, { ...LIGHT, id: 'edge' })
  table.words[baseOf(0) + LIGHT_FIELD.kind] = full
  assignDrawn(table, 0, false)
  const word = table.words[baseOf(0) + LIGHT_FIELD.kind]!
  assert.equal(
    word,
    LIGHT_KIND_MARKER + LIGHT_PAYLOAD_MASK,
    'all 23 bits used, none beyond the marker',
  )
  assert.ok(Number.isFinite(floatOf(word)) && floatOf(word) > 0)
  assert.equal(word >>> LIGHT_PAYLOAD_BITS, 1, 'bit 23 alone is above the payload')
})

test('the greatest light function index the word has bits for encodes and decodes exactly through the word, and no light is refused for it', () => {
  const light: SceneLight = {
    ...{ ...LIGHT, castsShadow: true, shadowsFog: true },
    ...{ transmission: true, mobility: 'movable' },
  }
  const greatest = LIGHT_FUNCTION_ENTRIES - 1
  const word = kindWordOf(light, NO_LIGHT_SHADOW_VIEW, greatest)
  assert.equal((word >>> LIGHT_FUNCTION_SHIFT) % LIGHT_FUNCTION_ENTRIES, greatest)
  assert.equal(
    word % 2 ** LIGHT_FUNCTION_SHIFT,
    LIGHT_KIND.point +
      LIGHT_FLAG.castsShadow +
      LIGHT_FLAG.shadowsFog +
      LIGHT_FLAG.transmission +
      (LIGHT_SHADOWED.dynamic << LIGHT_SHADOWED_SHIFT),
    'the rank, the flags and the shadowed value it keeps',
  )
  // The table counts the lights that wear a light function, and takes as many as it is asked: a wearer set again keeps its place,
  // one removed makes room.
  const table = createLightTable()
  addLight(table, { ...LIGHT, id: 'last', castsShadow: false, lightFunction: 'stripes' })
  addLight(table, { ...LIGHT, id: 'bare', castsShadow: false })
  assert.equal(table.wearing, 1)
  removeLight(table, 'last')
  assert.equal(table.wearing, 0)
})

test('a light’s kind word carries its rank and its flags, and lane 14 the share the fog scatters', () => {
  const store = createSceneLightStore()
  const word = (id: string) => rankAndFlags(kindWord(store, id))
  const share = (id: string) => store.packed[baseOf(store.slotOf(id)) + LIGHT_FIELD.fogScattering]
  store.add({ ...LIGHT, id: 'cast' })
  store.add({ ...LIGHT, id: 'dark', castsShadow: false, fogScattering: 0.25 })
  store.add({ ...LIGHT, id: 'fog', shadowsFog: true })
  store.add({
    id: 'sun',
    kind: 'directional',
    direction: [0, -1, 0],
    color: [1, 1, 1],
    intensity: 1,
    castsShadow: true,
  })
  assert.equal(word('cast'), LIGHT_KIND.point + LIGHT_FLAG.castsShadow)
  assert.equal(word('dark'), LIGHT_KIND.point)
  assert.equal(word('fog'), LIGHT_KIND.point + LIGHT_FLAG.castsShadow + LIGHT_FLAG.shadowsFog)
  assert.equal(word('sun'), LIGHT_KIND.directional + LIGHT_FLAG.castsShadow + LIGHT_FLAG.shadowsFog)
  assert.equal(store.kindOf(store.slotOf('sun')), LIGHT_KIND.directional, 'the rank alone')
  assert.ok(word('sun') >= LIGHT_KIND_SPAN)
  assert.equal(share('cast'), 1, 'one by default')
  assert.equal(share('dark'), 0.25)
  store.set('dark', { fogScattering: 0.5 })
  assert.equal(share('dark'), 0.5, 'a change of the share is a change of light')
  assert.throws(() => store.add({ ...LIGHT, id: 'bad', fogScattering: -1 }), /fogScattering/)
  assert.throws(() => store.add({ ...LIGHT, id: 'bad', shadowsFog: 1 as never }), /shadowsFog/)
})

test('a rectangle that casts, and shadows the fog, carries both flags and counts as a shadowed local light', () => {
  const store = createSceneLightStore()
  const panel = {
    ...{ id: 'panel', kind: 'rect', position: [0, 3, 0], range: 10, direction: [0, -1, 0] },
    ...{ right: [1, 0, 0], size: [2, 1], color: [1, 1, 1], intensity: 4, castsShadow: true },
  } as SceneLight
  store.add({ ...panel, shadowsFog: true })
  const word = rankAndFlags(kindWord(store, 'panel'))
  assert.equal(word, LIGHT_KIND.rect + LIGHT_FLAG.castsShadow + LIGHT_FLAG.shadowsFog)
  assert.deepEqual([store.shadowedLocals, store.shadowedSuns, store.rects], [1, 0, 1])
  store.set('panel', { castsShadow: false })
  assert.deepEqual([store.shadowedLocals, store.rects], [0, 1], 'a rectangle that casts none')
})

test('a light’s lighting channels sit stored in the bits of its kind word above the flags, under its shadowed value, and leave its rank and flags as they are', () => {
  const store = createSceneLightStore()
  const word = (id: string) => kindWord(store, id)
  const channelsOf = (id: string) =>
    (word(id) >>> LIGHT_CHANNELS_SHIFT) % 2 ** LIGHTING_CHANNEL_COUNT
  store.add({ ...LIGHT, id: 'default' })
  const second = { channel0: false, channel1: true, channel2: false }
  store.add({ ...LIGHT, id: 'one', lightingChannels: second })
  const cast = LIGHT_KIND.point + LIGHT_FLAG.castsShadow
  // Stored: the default is zero, so a word nothing wrote channels in says channel 0 alone.
  assert.equal(channelsOf('default'), 0, 'no channel bits for the default')
  assert.equal(channelsOf('one'), 3, '0b010 ^ 0b001')
  assert.equal(rankAndFlags(word('one')), cast, 'the rank and the flags hold no channel')
  store.set('one', { lightingChannels: { channel0: true, channel1: true, channel2: true } })
  assert.equal(channelsOf('one'), 6)
  store.set('one', { castsShadow: false })
  assert.equal(channelsOf('one'), 6, 'a flag changes, the channels stay')
  assert.equal(rankAndFlags(word('one')), LIGHT_KIND.point)
})
