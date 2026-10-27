// A mutation that resets already-held values is not a change. A host that returns its
// fixed lights every frame — the common case of a bench loop — must stale nothing: neither the
// light's revision, which the shadow scheduler reads to remake its pages, nor the store
// epoch, which the frame rereads to push its buffer.
import test from 'node:test'
import assert from 'node:assert/strict'
import { DRAW_FARTHEST, DRAW_LANES, DRAW_SHARE, LIGHT_FIELD, baseOf, kindWordOf } from './fields.ts'
import { createSceneLightStore, type SceneLightStore } from './store.ts'
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
  SCENE_LIGHT_HEADER_FLOATS,
  type SceneLight,
} from './contracts.ts'
import { LIGHTING_CHANNEL_COUNT } from '../../contracts/lightingChannelsAbi.ts'
import { NO_LIGHT_SHADOW_VIEW } from './shadowedBits.ts'
import { DEFAULT_VIGNETTE, environmentVignette } from '../core/environment.ts'

/** The kind word of light `id` as the store packs it (`LIGHT_FIELD.kind`): a whole number held in the bits of its float, read through the
 *  words of the same buffer. */
const kindWord = (store: SceneLightStore, id: string) =>
  new Uint32Array(store.packed.buffer)[baseOf(store.slotOf(id)) + LIGHT_FIELD.kind]!
/** The rank and the flags of a kind word: the bits under the channels. */
const rankAndFlags = (word: number) => word % 2 ** LIGHT_CHANNELS_SHIFT

const LIGHT: SceneLight = {
  id: 'l0',
  kind: 'point',
  position: [1, 2, 3],
  color: [1, 0.5, 0.25],
  intensity: 4,
  range: 10,
  castsShadow: true,
}

test('a light reset identically raises neither its revision nor the epoch', () => {
  const store = createSceneLightStore()
  const slot = store.add({ ...LIGHT })
  const epoch = store.epoch,
    revision = store.revision[slot]
  // The arrays are new instances: value equality must decide.
  for (let i = 0; i < 10; i++)
    store.set('l0', { position: [1, 2, 3], color: [1, 0.5, 0.25], intensity: 4, range: 10 })
  assert.equal(store.epoch, epoch, 'ten identical mutations, no epoch published')
  assert.equal(store.revision[slot], revision, 'and no shadow page staled')
})

test('a single number that changes does publish the change', () => {
  const store = createSceneLightStore()
  const slot = store.add({ ...LIGHT })
  const epoch = store.epoch,
    revision = store.revision[slot]
  store.set('l0', { intensity: 4.5 })
  assert.equal(store.epoch, epoch + 1)
  assert.equal(store.revision[slot], revision + 1)
  assert.equal(store.light('l0')!.intensity, 4.5)
  // An array component counts as much as a simple field.
  store.set('l0', { position: [1, 2, 3.5] })
  assert.equal(store.epoch, epoch + 2)
  assert.deepEqual(store.light('l0')!.position, [1, 2, 3.5])
})

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

test('a light follows the exposure by a blend from 0 to 1, a local light alone; the blend is a change, written beside the light’s strength', () => {
  const store = createSceneLightStore()
  store.add({ ...LIGHT })
  const at = () => baseOf(store.slotOf('l0'))
  const blendOf = () => store.packed[at() + LIGHT_FIELD.exposureBlend]
  const strength = store.packed[at() + LIGHT_FIELD.intensity]
  assert.equal(blendOf(), 0)
  const epoch = store.epoch
  store.set('l0', { inverseExposureBlend: 0 })
  assert.equal(store.epoch, epoch, 'the default reset is no change')
  store.set('l0', { inverseExposureBlend: 0.5 })
  assert.equal(store.epoch, epoch + 1)
  assert.equal(blendOf(), 0.5, 'the blend rides beside the strength, which stays the light’s own')
  assert.equal(store.packed[at() + LIGHT_FIELD.intensity], strength)
  for (const bad of [-0.1, 1.5, NaN, '1'])
    assert.throws(
      () => store.set('l0', { inverseExposureBlend: bad as never }),
      /inverseExposureBlend/,
    )
  assert.throws(
    () =>
      store.add({
        id: 'sun',
        kind: 'directional',
        direction: [0, -1, 0],
        color: [1, 1, 1],
        intensity: 1,
        castsShadow: false,
        inverseExposureBlend: 0.5,
      }),
    /inverseExposureBlend exists only for a point, a spot or a rect/,
  )
})

test('turning off via the shadow flag remains a change', () => {
  const store = createSceneLightStore()
  store.add({ ...LIGHT })
  const epoch = store.epoch
  store.set('l0', { castsShadow: false })
  assert.equal(store.epoch, epoch + 1)
  store.set('l0', { castsShadow: false })
  assert.equal(store.epoch, epoch + 1, 'reset twice, published once')
})

test('a shadow slice moved is pushed to the GPU, never a change of light transport', () => {
  const store = createSceneLightStore()
  const slot = store.add({ ...LIGHT })
  const epoch = store.epoch,
    transport = store.transportEpoch
  // A lamp leaving the view gives up its maps, the next one's are renumbered: addresses only.
  store.assignSlice(slot, 8192 * 64)
  store.assignSlice(slot, -1)
  assert.equal(store.epoch, epoch + 2, 'the buffer is pushed')
  assert.equal(store.transportEpoch, transport, 'the bounce keeps its history')
  store.assignSlice(slot, -1)
  assert.equal(store.epoch, epoch + 2, 'the same slice publishes nothing')
  store.set('l0', { intensity: 5 })
  assert.equal(store.transportEpoch, transport + 1)
})

test('the environment follows the same rule as the lights', () => {
  const store = createSceneLightStore()
  store.setEnvironment({ exposure: 1.5 })
  const epoch = store.epoch
  store.setEnvironment({ exposure: 1.5 })
  assert.equal(store.epoch, epoch, 'an exposure reset as-is does not stale the frame')
  store.setEnvironment({ exposure: 1.6 })
  assert.equal(store.epoch, epoch + 1)
  assert.equal(store.environment!.exposure, 1.6)
})

test('the vignette is a look: checked, 0.4 by default, and a change of it moves no light', () => {
  const store = createSceneLightStore()
  assert.equal(environmentVignette(store.environment), DEFAULT_VIGNETTE)
  assert.equal(DEFAULT_VIGNETTE, 0.4)
  store.setEnvironment({ exposure: 1, vignette: 0.4 })
  const { epoch, transportEpoch } = store
  store.setEnvironment({ exposure: 1, vignette: 0.4 })
  assert.equal(store.epoch, epoch, 'a vignette reset as-is does not stale the frame')
  store.setEnvironment({ exposure: 1, vignette: 0.8 })
  assert.equal(store.epoch, epoch + 1)
  assert.equal(store.transportEpoch, transportEpoch, 'it carries no light: no transport moves')
  assert.equal(environmentVignette(store.environment), 0.8)
  store.setEnvironment({ exposure: 1, vignette: 0 })
  assert.equal(environmentVignette(store.environment), 0, 'none')
  assert.throws(() => store.setEnvironment({ exposure: 1, vignette: -0.1 }), /vignette/)
  assert.throws(() => store.setEnvironment({ exposure: 1, vignette: Number.NaN }), /vignette/)
})

test('the lit view without a light is no longer an albedo view', () => {
  const store = createSceneLightStore()
  assert.equal(store.unlit, true, 'auto without a light: raw albedo, that is the default')
  store.setView('lit')
  assert.equal(store.unlit, false, 'lit asked explicitly: the contract lights, hence black')
  store.setView('unlit')
  assert.equal(store.unlit, true)
})

test('300 lights: every one is published, in the grown table the GPU reads', () => {
  const store = createSceneLightStore()
  const first = store.packed
  for (let i = 0; i < 300; i++)
    store.add({ ...LIGHT, id: `l${i}`, position: [i, 0, 0], castsShadow: false })
  const header = new Uint32Array(store.packed.buffer, 0, SCENE_LIGHT_HEADER_FLOATS)
  assert.equal(store.count, 300)
  assert.ok(store.capacity >= 300)
  assert.equal(header[0], 300, 'count published')
  assert.notEqual(store.packed, first, 'the table grew')
  assert.ok(store.revision.length >= 300)
  for (let slot = 0; slot < 300; slot++)
    assert.equal(store.packed[baseOf(slot) + LIGHT_FIELD.position], slot, `light ${slot} written`)
  store.remove('l0')
  assert.equal(store.packed[baseOf(0) + LIGHT_FIELD.position], 299, 'the last took its slot')
})

// The lit programs' key walked every light of the store at each epoch to learn these kinds.
test('the store counts its shadowed suns, shadowed local lights and rectangles as they change', () => {
  const store = createSceneLightStore()
  const kinds = () => [store.shadowedSuns, store.shadowedLocals, store.rects]
  const { color, intensity } = LIGHT
  store.add({ ...LIGHT })
  store.add({
    id: 'sun',
    kind: 'directional',
    color,
    intensity,
    direction: [0, -1, 0],
    castsShadow: false,
  })
  store.add({
    id: 'panel',
    kind: 'rect',
    castsShadow: false,
    color,
    intensity,
    position: [0, 2, 0],
    range: 5,
    direction: [0, -1, 0],
    right: [1, 0, 0],
    size: [1, 1],
  })
  assert.deepEqual(kinds(), [0, 1, 1], 'a sun casting none is not counted')
  assert.deepEqual([store.suns, store.locals], [1, 2], 'the lit passes’ lights, shadowed or not')
  store.set('sun', { castsShadow: true })
  store.set('l0', { castsShadow: false })
  assert.deepEqual(kinds(), [1, 0, 1], 'a change moves the counts')
  store.remove('sun')
  store.remove('panel')
  assert.deepEqual(kinds(), [0, 0, 0])
  assert.deepEqual([store.suns, store.locals], [0, 1])
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

test('a rectangle’s sides are held to 1 cm where the lighting reads them, the light as declared', () => {
  const store = createSceneLightStore()
  const sides = (id: string) => {
    const at = baseOf(store.slotOf(id))
    return [store.packed[at + LIGHT_FIELD.halfWidth], store.packed[at + LIGHT_FIELD.halfHeight]]
  }
  const panel = {
    ...{ id: 'thin', kind: 'rect', position: [0, 3, 0], range: 10, direction: [0, -1, 0] },
    ...{ right: [1, 0, 0], size: [0.001, 2], color: [1, 1, 1], intensity: 4, castsShadow: false },
  } as SceneLight
  store.add(panel)
  assert.deepEqual(
    sides('thin').map((v) => +v.toFixed(6)),
    [0.005, 1],
    'width 1 cm, height as given',
  )
  assert.deepEqual(store.light('thin')!.size, [0.001, 2], 'the record keeps what the host declared')
  store.add({ ...panel, id: 'wide', size: [3, 0.005] })
  assert.deepEqual(
    sides('wide').map((v) => +v.toFixed(6)),
    [1.5, 0.005],
    'height 1 cm',
  )
})

test('a light transmits through the profile surfaces only when it asks, casts and is movable', () => {
  const store = createSceneLightStore()
  const word = (id: string) => rankAndFlags(kindWord(store, id))
  store.add({ ...LIGHT, id: 'asks', transmission: true, mobility: 'movable' })
  store.add({ ...LIGHT, id: 'still', transmission: true })
  store.add({ ...LIGHT, id: 'dark', transmission: true, mobility: 'movable', castsShadow: false })
  store.add({ ...LIGHT, id: 'plain', mobility: 'movable' })
  const cast = LIGHT_KIND.point + LIGHT_FLAG.castsShadow
  assert.equal(word('asks'), cast + LIGHT_FLAG.transmission)
  assert.equal(word('still'), cast, 'a stationary light has its shadow baked')
  assert.equal(word('dark'), LIGHT_KIND.point, 'no shadow, no transmission')
  assert.equal(word('plain'), cast, 'off by default')
  assert.throws(() => store.add({ ...LIGHT, id: 'bad', transmission: 1 as never }), /transmission/)
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

test('a sun’s source term holds the sine of its angular radius, a point’s the weight of its rough diffuse: 1 for a source of no size, fading to 0 at 20 cm', () => {
  const store = createSceneLightStore()
  const term = (id: string) => store.packed[baseOf(store.slotOf(id)) + LIGHT_FIELD.sourceTerm]
  store.add({ ...LIGHT })
  store.add({
    id: 'sun',
    kind: 'directional',
    direction: [0, -1, 0],
    color: [1, 1, 1],
    intensity: 1,
    castsShadow: true,
    angularRadius: 0.01,
  })
  assert.equal(term('l0'), 1, 'a point: a full weight')
  assert.equal(term('sun'), Math.fround(Math.sin(Math.fround(0.01))))
  store.set('sun', { angularRadius: 0.02 })
  assert.equal(term('sun'), Math.fround(Math.sin(Math.fround(0.02))))
  store.set('l0', { emitterRadius: 0.05 })
  assert.equal(term('l0'), Math.fround(1 - 0.05 / 0.2), 'a quarter of the way to 20 cm')
  store.set('l0', { emitterRadius: 0.5, range: 20 })
  assert.equal(term('l0'), 0, 'past 20 cm: none')
  store.set('l0', { emitterRadius: undefined as never, emitterLength: 0.1 })
  assert.equal(term('l0'), Math.fround(0.5), 'a tube’s length counts as its size')
})

test('a light’s draw range sits in the store’s draw lanes, the CPU’s alone: the share of the screen per metre under which it is left out and its greatest distance, folded with the view’s settings', () => {
  const store = createSceneLightStore()
  const lane = (id: string, field: 'drawShare' | 'maxDrawDistance') =>
    store.draw[store.slotOf(id) * DRAW_LANES + (field === 'drawShare' ? DRAW_SHARE : DRAW_FARTHEST)]
  store.add({ ...LIGHT, id: 'small', range: 1 })
  store.add({ ...LIGHT, id: 'large', range: 10, maxDrawDistance: 20 })
  store.add({
    id: 'sun',
    kind: 'directional',
    direction: [0, -1, 0],
    color: [1, 1, 1],
    intensity: 1,
    castsShadow: false,
  })
  const share = (id: string) => lane(id, 'drawShare')
  assert.equal(
    share('small'),
    Math.fround(0.02),
    'a light of 1 m or less: the most, 0.02 per metre',
  )
  assert.equal(share('large'), Math.fround(0.03 / 10))
  assert.equal(share('sun'), 0, 'a sun is never left out')
  assert.deepEqual(
    ['small', 'large', 'sun'].map((id) => lane(id, 'maxDrawDistance')),
    [0, 20, 0],
  )
  const epoch = store.epoch
  store.setRangeView({ lightMinScreenRadius: 0.06, lightMaxDrawDistanceScale: 2 })
  assert.equal(store.epoch, epoch + 1, 'a new view is published')
  assert.equal(share('large'), Math.fround(0.06 / 10))
  assert.equal(lane('large', 'maxDrawDistance'), 40)
  store.setRangeView({ lightMinScreenRadius: 0.06, lightMaxDrawDistanceScale: 2 })
  assert.equal(store.epoch, epoch + 1, 'the same view is no change')
  store.setRangeView({ lightMinScreenRadius: 0, lightMaxDrawDistanceScale: 0 })
  assert.equal(share('small'), 0, 'a setting of 0 leaves no light out by its size')
  assert.ok(
    lane('large', 'maxDrawDistance') > 0,
    'a scale of 0 leaves a light that names a distance out everywhere',
  )
})

test('a change of a light’s channels is a change of light, counted while it is not the default', () => {
  const store = createSceneLightStore()
  const slot = store.add({ ...LIGHT })
  assert.equal(store.channelled, 0)
  const revision = store.revision[slot]
  store.set('l0', { lightingChannels: { channel0: true, channel1: false, channel2: false } })
  assert.equal(store.revision[slot], revision, 'the default written is no change')
  store.set('l0', { lightingChannels: { channel0: false, channel1: false, channel2: true } })
  assert.equal(store.revision[slot], revision + 1)
  assert.equal(store.channelled, 1)
  store.set('l0', { lightingChannels: { channel0: true, channel1: false, channel2: false } })
  assert.equal(store.channelled, 0)
  assert.throws(
    () => store.add({ ...LIGHT, id: 'bad', lightingChannels: { channel0: true } as never }),
    /lightingChannels is \{ channel0/,
  )
})

test('the view’s decision rides in the kind word apart from the light: no epoch moves, a write of the light says drawn again, the rest of the word stays', () => {
  const store = createSceneLightStore()
  const slot = store.add({ ...LIGHT, id: 'a', intensity: 2 })
  store.add({ ...LIGHT, id: 'b' })
  const undrawn = (id: string) => (kindWord(store, id) >>> LIGHT_UNDRAWN_SHIFT) & 1
  const whole = kindWord(store, 'a')
  const epoch = store.epoch,
    revision = store.revision[slot]
  assert.equal(undrawn('a'), 0, 'a light written anew is drawn')
  assert.equal(store.assignDrawn(slot, false), true)
  assert.equal(undrawn('a'), 1)
  assert.equal(undrawn('b'), 0, 'the other light is not touched')
  assert.equal(kindWord(store, 'a') ^ whole, 2 ** LIGHT_UNDRAWN_SHIFT, 'one bit of the word moved')
  assert.equal(store.assignDrawn(slot, false), false, 'the same decision again is no change')
  assert.deepEqual(
    [store.epoch, store.revision[slot]],
    [epoch, revision],
    'it is no change of the lights',
  )
  store.set('a', { intensity: 3 })
  assert.equal(undrawn('a'), 0, 'a write of the light says drawn again, the view decides again')
  store.assignDrawn(slot, false)
  assert.equal(store.assignDrawn(slot, true), true)
  assert.equal(undrawn('a'), 0)
  assert.equal(kindWord(store, 'a'), whole)
})
