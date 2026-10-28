// A light's draw range, its channels and its rectangle sides, as the store holds and publishes them.
import test from 'node:test'
import assert from 'node:assert/strict'
import { DRAW_FARTHEST, DRAW_LANES, DRAW_SHARE, LIGHT_FIELD, baseOf } from './fields.ts'
import { createSceneLightStore } from './store.ts'
import { assignDrawn } from './storeTable.ts'
import { LIGHT_FLAG, LIGHT_KIND, LIGHT_UNDRAWN_SHIFT, type SceneLight } from './contracts.ts'
import { kindWord, rankAndFlags, LIGHT } from './store.fixture.ts'

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
