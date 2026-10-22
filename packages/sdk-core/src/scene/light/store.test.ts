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
import {
  DEFAULT_VIGNETTE,
  ENVIRONMENT_COEFFICIENTS,
  environmentVignette,
} from '../core/environment.ts'
import { near } from '../../../../math/src/float/near.fixture.ts'
import { validateSceneAtmosphere } from '../core/atmosphere.ts'
import { ATMOSPHERE_SLOT } from '../core/atmospherePack.ts'
import { FOG_SLOT } from '../core/fog.ts'

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
  store.set('sun', { castsShadow: true })
  store.set('l0', { castsShadow: false })
  assert.deepEqual(kinds(), [1, 0, 1], 'a change moves the counts')
  store.remove('sun')
  store.remove('panel')
  assert.deepEqual(kinds(), [0, 0, 0])
})

test('the sun is held whatever the air: put out and on again, it is not forgotten', () => {
  const store = createSceneLightStore()
  const light = (id: string, kind: 'directional' | 'point', direction: [number, number, number]) =>
    store.add(
      kind === 'point'
        ? {
            id,
            kind,
            position: direction,
            range: 10,
            color: [1, 1, 1],
            intensity: 3,
            castsShadow: false,
          }
        : { id, kind, direction, color: [1, 1, 1], intensity: 3, castsShadow: false },
    )
  const toward = (block: Float32Array, at: number) => block.subarray(at, at + 3)
  const air = () => toward(store.atmospherePacked, ATMOSPHERE_SLOT.sunDirection * 4)
  const fog = () => toward(store.environmentPacked, ENVIRONMENT_COEFFICIENTS * 4 + FOG_SLOT.sun * 4)
  const [a, b, c] = [
    [-1, 0, 0],
    [0, -1, 0],
    [0, 0, -1],
  ] as const
  store.setEnvironment({ exposure: 1, fog: {} })
  light('p', 'point', [0, 5, 0])
  light('a', 'directional', [...a])
  near(fog(), [1, 0, 0], 'a is the sun, without air')
  // The point light's removal frees the lowest rank: b takes it. It is equal and later, so a keeps
  // the sun, and the fog scatters a.
  store.remove('p')
  light('b', 'directional', [...b])
  near(fog(), [1, 0, 0], 'a holds the sun against b, which has the lower rank')
  // b removed, c takes its rank: still a, which the air set now reads.
  store.remove('b')
  light('c', 'directional', [...c])
  store.setEnvironment({ exposure: 1, fog: {}, atmosphere: validateSceneAtmosphere(true) })
  near(air(), [1, 0, 0], 'a, held while there was no air, not c of the lowest rank')
  store.setEnvironment({ exposure: 1 })
  store.setEnvironment({ exposure: 1, atmosphere: validateSceneAtmosphere(true) })
  near(air(), [1, 0, 0], 'the air put out and on again: a still')
  // The first directional light removed, the fog's fallback is empty until a directional light is
  // added again — as one that stops lighting the air is: removed and added again.
  store.setEnvironment({ exposure: 1, fog: {} })
  store.remove('a')
  near(fog(), [0, 0, 1], 'c, the sun now')
  store.set('c', { atmosphereSun: false })
  near(fog(), [0, 0, 1], 'c no longer lights the air: added again, the fog falls back on it')
})

test('the air holds a light for each index, the brightest of its candidates; a light moved is removed and added again', () => {
  const store = createSceneLightStore()
  const base: Omit<SceneLight, 'id' | 'intensity'> = {
    kind: 'directional',
    color: [1, 1, 1],
    castsShadow: false,
  }
  const sun = (id: string, intensity: number, index: 0 | 1, direction: [number, number, number]) =>
    store.add({ ...base, id, intensity, direction, atmosphereSunIndex: index })
  const air = (slot: number) => Array.from(store.atmospherePacked.subarray(slot * 4, slot * 4 + 3))
  const color = (id: string) => store.packed[baseOf(store.slotOf(id)) + LIGHT_FIELD.color]
  const [first, second] = [ATMOSPHERE_SLOT.sunDirection, ATMOSPHERE_SLOT.secondDirection]
  store.setEnvironment({ exposure: 1, atmosphere: validateSceneAtmosphere(true) })
  sun('sun', 5, 0, [-1, 0, 0])
  sun('moon', 1, 1, [0, 0, -1])
  sun('moon2', 2, 1, [0, -1, 0])
  near(air(second), [0, 1, 0], 'the brighter of index 1')
  store.remove('moon2')
  near(air(second), [0, 0, 1], 'removed: the moon again')
  assert.ok(color('moon') < 1 && color('sun') < 1, 'each tinted by the air toward it')
  store.set('sun', { atmosphereSunIndex: 1 })
  near(air(first), [0, 0, 0], 'index 0 has none: no remapping')
  near(air(second), [1, 0, 0], 'the sun, brighter, holds index 1')
  assert.equal(color('moon'), 1, 'the moon it displaced is as declared again')
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

test('with no atmosphere the block holds the lights of the air as the clouds light a medium by them', () => {
  const store = createSceneLightStore()
  const slot = store.add({
    id: 'sun',
    kind: 'directional',
    direction: [0, -1, 0],
    color: [1, 0.5, 0.25],
    intensity: 4,
    castsShadow: false,
  })
  const block = (at: number) => Array.from(store.atmospherePacked.subarray(at * 4, at * 4 + 4))
  assert.equal(block(ATMOSPHERE_SLOT.planet)[0], 0, 'no air')
  near(block(ATMOSPHERE_SLOT.sunDirection), [0, 1, 0, 1], 'toward the light, with no disk')
  near(block(ATMOSPHERE_SLOT.sunIlluminance), [4, 2, 1, 0], 'its illuminance, whole')
  near(block(ATMOSPHERE_SLOT.sunDisk), [0, 0, 0, 1], 'no luminance of a disk, and a light')
  near(block(ATMOSPHERE_SLOT.sunTransmittance), [1, 1, 1, 0], 'no air toward it, none for the fog')
  near(block(ATMOSPHERE_SLOT.secondDisk), [0, 0, 0, 0], 'no second light')
  near(block(ATMOSPHERE_SLOT.lightSlots), [slot, -1, 0, 0], 'its place in the light buffer')
  near(block(ATMOSPHERE_SLOT.lightFlags), [0, 0, 0, 0], 'it shades no air')
  store.set('sun', { intensity: 2 })
  near(block(ATMOSPHERE_SLOT.sunIlluminance), [2, 1, 0.5, 0], 'it follows the light')
  store.remove('sun')
  near(block(ATMOSPHERE_SLOT.lightSlots), [-1, -1, 0, 0], 'removed: no slot, never the first')
  near(block(ATMOSPHERE_SLOT.sunIlluminance), [0, 0, 0, 0], 'and no illuminance')
})
