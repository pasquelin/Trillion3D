// A mutation that resets already-held values is not a change. A host that returns its
// fixed lights every frame — the common case of a bench loop — must stale nothing: neither the
// light's revision, which the shadow scheduler reads to remake its pages, nor the store
// epoch, which the frame rereads to push its buffer.
import test from 'node:test'
import assert from 'node:assert/strict'
import { LIGHT_FIELD, baseOf } from './fields.ts'
import { createSceneLightStore } from './store.ts'
import {
  LIGHT_FLAG,
  LIGHT_KIND,
  LIGHT_KIND_SPAN,
  SCENE_LIGHT_HEADER_FLOATS,
  type SceneLight,
} from './contracts.ts'
import { DEFAULT_VIGNETTE, environmentVignette } from '../core/environment.ts'

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
  const word = (id: string) => store.packed[baseOf(store.slotOf(id)) + LIGHT_FIELD.kind]
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
  const word = store.packed[baseOf(store.slotOf('panel')) + LIGHT_FIELD.kind]
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
  const word = (id: string) => store.packed[baseOf(store.slotOf(id)) + LIGHT_FIELD.kind]
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
