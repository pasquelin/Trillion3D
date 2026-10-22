// The fog and the light store: the store writes the sun the fog scatters — the one it holds, else
// the first directional light, equal suns told apart by the order of adding —, a fog changed stales
// the frame and the same fog set again does not, and a change of fog alone leaves light transport
// and the bounce probes as they were.
import test from 'node:test'
import assert from 'node:assert/strict'
import { near } from '../../../../math/src/float/near.fixture.ts'
import { createSceneLightStore } from '../light/store.ts'
import { validateSceneAtmosphere } from './atmosphere.ts'
import { ATMOSPHERE_SLOT } from './atmospherePack.ts'
import { ENVIRONMENT_COEFFICIENTS } from './environment.ts'
import { FOG_SLOT } from './fog.ts'

const GREY = [0.5, 0.5, 0.5] as const

test('the store writes the sun the fog scatters: the one it holds, else the first directional light', () => {
  const store = createSceneLightStore()
  const sun = (
    id: string,
    direction: [number, number, number],
    intensity: number,
    atmosphereSun?: boolean,
  ) =>
    store.add({
      id,
      kind: 'directional',
      direction,
      color: [1, 0.5, 0],
      intensity,
      castsShadow: false,
      atmosphereSun,
    })
  const sunSlot = () =>
    Array.from(store.environmentPacked.subarray(36 + FOG_SLOT.sun * 4, 36 + FOG_SLOT.sun * 4 + 4))
  store.setEnvironment({ exposure: 1, fog: {} })
  assert.deepEqual(sunSlot(), [0, 0, 0, 0])
  sun('first', [0, -1, 0], 2)
  // Toward the sun, then the luminance of its colour times its intensity.
  const luminance = 2 * (0.2126390059 + 0.5 * 0.7151686788)
  near(sunSlot(), [0, 1, 0, luminance], 'the first sun', 1e-6)
  // The brightest is the sun, with an atmosphere or none.
  sun('second', [1, 0, 0], 20)
  near(sunSlot(), [-1, 0, 0, 10 * luminance], 'the brighter light, without air', 1e-5)
  store.setEnvironment({ exposure: 1, fog: {}, atmosphere: validateSceneAtmosphere(true) })
  near(sunSlot().slice(0, 3), [-1, 0, 0], 'the atmosphere’s sun, the brightest')
  store.remove('second')
  near(sunSlot().slice(0, 3), [0, 1, 0], 'the sun removed, the next light')
  // A light left out of the air's candidates is the fog's only where none is a candidate.
  store.remove('first')
  sun('off', [0, 0, -1], 50, false)
  near(sunSlot().slice(0, 3), [0, 0, 1], 'no candidate: the first directional light added')
  sun('on', [1, 0, 0], 1)
  near(sunSlot().slice(0, 3), [-1, 0, 0], 'a candidate, however dim, is the sun')
  // No fog, no write: a scene without a fog pays nothing.
  store.setEnvironment({ exposure: 1 })
  assert.deepEqual(sunSlot(), [0, 0, 0, 0])
})

test('equal suns are told apart by the order of adding, which a removal does not change', () => {
  const store = createSceneLightStore()
  const sun = (id: string, direction: [number, number, number], intensity = 3) =>
    store.add({
      id,
      kind: 'directional',
      direction,
      color: [1, 1, 1],
      intensity,
      castsShadow: false,
    })
  const toward = (block: Float32Array, at: number) => block.subarray(at, at + 3)
  const air = () => toward(store.atmospherePacked, ATMOSPHERE_SLOT.sunDirection * 4)
  const fog = () => toward(store.environmentPacked, ENVIRONMENT_COEFFICIENTS * 4 + FOG_SLOT.sun * 4)
  const [a, b, c, d] = [
    [-1, 0, 0],
    [0, -1, 0],
    [0, 0, -1],
    [0, 1, 0],
  ] as const
  // The sun is the first of equals, held without air: the fog scatters it.
  store.setEnvironment({ exposure: 1, fog: {} })
  sun('a', [...a])
  sun('b', [...b])
  sun('c', [...c])
  near(fog(), [1, 0, 0], 'the first added')
  // The sun removed: b, which was added before c, though the table packs c into a's slot.
  store.remove('a')
  near(fog(), [0, 1, 0], 'a removed, b was added before c')
  // A light added takes the rank a removal freed; equal to the sun held, it does not replace it.
  sun('d', [...d])
  near(fog(), [0, 1, 0], 'd is equal and later: it does not replace b')
  store.remove('b')
  near(fog(), [0, -1, 0], 'b removed: d, which holds the rank a freed, ahead of c')
  // The air set afterwards reads the sun held all along.
  store.setEnvironment({ exposure: 1, atmosphere: validateSceneAtmosphere(true) })
  near(air(), [0, -1, 0], 'the sun held before the air was set')
  store.remove('d')
  near(air(), [0, 0, 1], 'd removed: c')
  sun('a', [...a])
  near(air(), [0, 0, 1], 'a is equal and later: it does not replace c')
  // A change of brightness, colour or direction never chooses the sun again.
  store.set('a', { intensity: 4 })
  near(air(), [0, 0, 1], 'a brightened does not take the sun held')
  store.set('c', { intensity: 1 })
  near(air(), [0, 0, 1], 'c dimmed keeps its place')
  // A light that stops lighting the air leaves the place as a removal does; back, it is added again.
  store.set('c', { atmosphereSun: false })
  near(air(), [1, 0, 0], 'c set off: the brightest of the others, a')
  store.set('c', { atmosphereSun: true, intensity: 5 })
  near(air(), [0, 0, 1], 'c back on, brighter than a: added again, it takes the place')
})

test('a fog changed stales the frame; the same fog set again does not', () => {
  const store = createSceneLightStore()
  store.setEnvironment({ exposure: 1, fog: { color: GREY, near: 3, far: 30 } })
  const epoch = store.epoch
  store.setEnvironment({ exposure: 1, fog: { color: [0.5, 0.5, 0.5], near: 3, far: 30 } })
  assert.equal(store.epoch, epoch)
  store.setEnvironment({ exposure: 1, fog: { color: GREY, near: 3, far: 31 } })
  assert.equal(store.epoch, epoch + 1)
  store.setEnvironment({ exposure: 1 })
  assert.equal(store.epoch, epoch + 2)
})

test('a change of fog alone leaves light transport, and the bounce probes, as they were', () => {
  const store = createSceneLightStore()
  store.setEnvironment({ exposure: 1 })
  const transport = store.transportEpoch
  store.setEnvironment({ exposure: 1, fog: { color: GREY, density: 0.1 } })
  store.setEnvironment({ exposure: 1, fog: { color: GREY, near: 3, far: 30 } })
  store.setEnvironment({ exposure: 1 })
  assert.equal(store.transportEpoch, transport)
  store.setEnvironment({ exposure: 1, irradiance: Array(27).fill(0.1) })
  assert.equal(store.transportEpoch, transport + 1)
  store.add({
    id: 'sun',
    kind: 'directional',
    direction: [0, -1, 0],
    color: [1, 1, 1],
    intensity: 1,
    castsShadow: false,
  })
  assert.equal(store.transportEpoch, transport + 2)
})
