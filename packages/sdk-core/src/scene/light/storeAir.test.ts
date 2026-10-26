// The lights of the air the store holds: the sun kept whatever the air, one light for each of the
// air's indices (the brightest of its candidates), and the block that carries them to the clouds when
// the scene has no atmosphere. Split from `store.test.ts`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { LIGHT_FIELD, baseOf } from './fields.ts'
import { createSceneLightStore } from './store.ts'
import { type SceneLight } from './contracts.ts'
import { ENVIRONMENT_COEFFICIENTS } from '../core/environment.ts'
import { near } from '../../../../math/src/float/near.fixture.ts'
import { validateSceneAtmosphere } from '../core/atmosphere.ts'
import { ATMOSPHERE_SLOT } from '../core/atmospherePack.ts'
import { FOG_SLOT } from '../core/fog.ts'

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
  near(block(ATMOSPHERE_SLOT.sunDirection), [0, 0, 0, 0], 'no clouds ask: the block holds none')
  near(block(ATMOSPHERE_SLOT.lightSlots), [-1, -1, 0, 0], 'no light is named by a slot')
  store.setAirlessSuns(true)
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
  store.add({
    id: 'again',
    kind: 'directional',
    direction: [0, -1, 0],
    color: [1, 1, 1],
    intensity: 1,
    castsShadow: false,
  })
  store.setAirlessSuns(false)
  near(
    block(ATMOSPHERE_SLOT.sunIlluminance),
    [0, 0, 0, 0],
    'the clouds gone, the light is not packed',
  )
})
