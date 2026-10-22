// The fog contract: the environment carries it into the GPU block behind the irradiance,
// a fog changed stales the frame, the same fog set again does not, and a fog out of range is
// refused by name. The height fog's defaults are the converted numbers of the engines that fixed
// them, the extinction form is mapped to its law exactly, and the light store writes the sun the
// fog scatters.
import test from 'node:test'
import assert from 'node:assert/strict'
import { near } from '../../../../math/src/float/near.fixture.ts'
import { createSceneLightStore } from '../light/store.ts'
import { validateSceneAtmosphere } from './atmosphere.ts'
import { ATMOSPHERE_SLOT } from './atmospherePack.ts'
import { ENVIRONMENT_COEFFICIENTS, SCENE_ENVIRONMENT_FLOATS } from './environment.ts'
import { FOG_MODE, FOG_SLOT, packFog, validateSceneFog } from './fog.ts'
import { heightFogOf } from './fogHeight.ts'

const GREY = [0.5, 0.5, 0.5] as const

test('the fog block follows the irradiance: colour and mode, then the law and the rest', () => {
  // The fog's block is what `packFog` writes: absent, it zeroes the block and nothing beyond.
  const written = new Float32Array(64).fill(NaN)
  packFog(undefined, written, 0)
  const fogFloats = written.findIndex(Number.isNaN)
  assert.equal(SCENE_ENVIRONMENT_FLOATS, ENVIRONMENT_COEFFICIENTS * 4 + fogFloats)
  const store = createSceneLightStore()
  const block = () => Array.from(store.environmentPacked.subarray(36, 36 + fogFloats))
  const slot = (n: number) => block().slice(n * 4, n * 4 + 4)
  store.setEnvironment({ exposure: 1, fog: { color: GREY, near: 3, far: 30 } })
  assert.deepEqual(slot(FOG_SLOT.color), [0.5, 0.5, 0.5, FOG_MODE.linear])
  assert.deepEqual(slot(FOG_SLOT.law), [3, 30, 0, 0])
  // A distance fog takes the sky's radiance as it is.
  assert.deepEqual(slot(FOG_SLOT.sky), [1, 1, 1, 0])
  // The extinction form, mapped to the height law: density ÷ (ln 2)², falloff ÷ ln 2.
  store.setEnvironment({ exposure: 1, fog: { color: GREY, density: 0.25, heightFalloff: 0.5 } })
  assert.deepEqual(slot(FOG_SLOT.color), [0.5, 0.5, 0.5, FOG_MODE.exponential])
  assert.deepEqual(
    slot(FOG_SLOT.law).map(Math.fround),
    [0.25 / Math.LN2 ** 2, 0.5 / Math.LN2, 0, 1].map(Math.fround),
  )
  // The default height fog: black, 0.002 per metre, halving every 50 m, the lobe at 4 from 100 m.
  store.setEnvironment({ exposure: 1, fog: {} })
  assert.deepEqual(
    block()
      .slice(0, 20)
      .map((v) => Math.fround(v)),
    [
      ...[0, 0, 0, FOG_MODE.exponential],
      ...[0.002, 0.02, 0, 1],
      ...[0, 0, 4, 100],
      ...[0, 0, 0, 0],
      ...[1, 1, 1, 0],
    ].map((v) => Math.fround(v)),
  )
  store.setEnvironment({ exposure: 1 })
  assert.deepEqual(block(), new Array(fogFloats).fill(0))
})

test('the height fog’s defaults are the converted numbers: centimetres to metres, divided by 1000', () => {
  // Density and falloff 0.02 and 0.2 per 1000 centimetres: ÷ 10 per metre; distances ÷ 100.
  const d = heightFogOf({})
  assert.equal(d.baseDensity, 0.02 / 10)
  assert.equal(d.falloff, 0.2 / 10)
  assert.equal(d.directional.startDistance, 10000 / 100)
  assert.deepEqual(
    [d.directional.exponent, d.maxOpacity, d.startDistance, d.cutoffDistance, d.baseHeight],
    [4, 1, 0, 0, 0],
  )
  assert.deepEqual(
    [d.color, d.directional.color, d.skyContribution],
    [
      [0, 0, 0],
      [0, 0, 0],
      [1, 1, 1],
    ],
  )
  assert.equal(heightFogOf({ baseDensity: 0.5 }).baseDensity, 0.5)
  assert.equal(heightFogOf({ baseDensity: 0.5 }).falloff, d.falloff)
  // The extinction form: a uniform medium of `density` is a baseDensity of density / (ln 2)².
  const old = heightFogOf({ color: GREY, density: 0.03, heightFalloff: 0.3, baseHeight: 2 })
  assert.equal(old.baseDensity, 0.03 / Math.LN2 ** 2)
  assert.equal(old.falloff, 0.3 / Math.LN2)
  assert.deepEqual([old.baseHeight, old.maxOpacity, old.color], [2, 1, [0.5, 0.5, 0.5]])
  assert.equal(heightFogOf({ color: GREY, density: 0.03 }).falloff, 0)
})

test('a height fog that hides nothing is no fog', () => {
  const written = new Float32Array(24).fill(NaN)
  assert.equal(packFog({ baseDensity: 0 }, written, 0)[3], FOG_MODE.none)
  assert.equal(packFog({ maxOpacity: 0 }, written, 0)[3], FOG_MODE.none)
  assert.equal(packFog({ color: GREY, density: 0 }, written, 0)[3], FOG_MODE.none)
  assert.equal(packFog({ baseDensity: 0.001 }, written, 0)[3], FOG_MODE.exponential)
})

test('the store writes the sun the fog scatters: the atmosphere’s, else the first directional light', () => {
  const store = createSceneLightStore()
  const sun = (id: string, direction: [number, number, number], intensity: number) =>
    store.add({
      id,
      kind: 'directional',
      direction,
      color: [1, 0.5, 0],
      intensity,
      castsShadow: false,
    })
  const sunSlot = () =>
    Array.from(store.environmentPacked.subarray(36 + FOG_SLOT.sun * 4, 36 + FOG_SLOT.sun * 4 + 4))
  store.setEnvironment({ exposure: 1, fog: {} })
  assert.deepEqual(sunSlot(), [0, 0, 0, 0])
  sun('first', [0, -1, 0], 2)
  // Toward the sun, then the luminance of its colour times its intensity.
  const luminance = 2 * (0.2126390059 + 0.5 * 0.7151686788)
  near(sunSlot(), [0, 1, 0, luminance], 'the first sun', 1e-6)
  sun('second', [1, 0, 0], 20)
  near(sunSlot()[3], luminance, 'the first directional light', 1e-6)
  store.setEnvironment({ exposure: 1, fog: {}, atmosphere: validateSceneAtmosphere(true) })
  near(sunSlot().slice(0, 3), [-1, 0, 0], 'the atmosphere’s sun, the brightest')
  store.remove('second')
  near(sunSlot().slice(0, 3), [0, 1, 0], 'the sun removed, the next light')
  // No fog, no write: a scene without a fog pays nothing.
  store.setEnvironment({ exposure: 1 })
  assert.deepEqual(sunSlot(), [0, 0, 0, 0])
})

test('equal suns are told apart by the order of adding, which a removal does not change', () => {
  const store = createSceneLightStore()
  const sun = (id: string, direction: [number, number, number]) =>
    store.add({
      id,
      kind: 'directional',
      direction,
      color: [1, 1, 1],
      intensity: 3,
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
  // Without air the fog scatters the first light added.
  store.setEnvironment({ exposure: 1, fog: {} })
  sun('a', [...a])
  sun('b', [...b])
  sun('c', [...c])
  near(fog(), [1, 0, 0], 'the first added')
  // The table packs the last light into the removed one's slot: the order of adding stays.
  store.remove('a')
  near(fog(), [0, 1, 0], 'a removed, b was added before c')
  // A light added takes the rank a removal freed, the first of the list.
  sun('d', [...d])
  near(fog(), [0, -1, 0], 'd takes the rank of a, ahead of b and c')
  store.remove('d')
  sun('a', [...a])
  // The air's sun is the first of equals, and a light added later does not replace it.
  store.setEnvironment({ exposure: 1, atmosphere: validateSceneAtmosphere(true) })
  near(air(), [1, 0, 0], 'the first of equals')
  store.remove('a')
  near(air(), [0, 1, 0], 'a removed: b, not c, which fills its slot')
  sun('d', [...d])
  near(air(), [0, 1, 0], 'd is equal and later: it does not replace b')
  store.set('d', { intensity: 4 })
  near(air(), [0, -1, 0], 'brighter, it does')
  store.set('d', { intensity: 3 })
  store.remove('d')
  near(air(), [0, 1, 0], 'd removed: b, ahead of c')
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

test('a fog out of range is refused by name', () => {
  const refused = (fog: unknown) =>
    assert.throws(() => validateSceneFog(fog as never), { code: 'INVALID_SCENE_ENVIRONMENT' })
  refused({ color: GREY, near: 5, far: 5 })
  refused({ color: GREY, near: -1, far: 5 })
  refused({ color: [1, 1], near: 0, far: 5 })
  refused({ color: [-1, 0, 0], density: 1 })
  refused({ color: GREY, density: Number.NaN })
  refused({ color: GREY, density: 1, heightFalloff: -0.1 })
  refused({ color: GREY, density: 1, baseHeight: Infinity })
  // The height fog's own fields, each in its range.
  refused({ baseDensity: -1 })
  refused({ falloff: Number.NaN })
  refused({ baseHeight: Infinity })
  refused({ maxOpacity: 1.5 })
  refused({ startDistance: -1 })
  refused({ cutoffDistance: -1 })
  refused({ color: [0, 0] })
  refused({ skyContribution: [1, -1, 1] })
  refused({ directional: { exponent: 0 } })
  refused({ directional: { startDistance: -5 } })
  refused({ directional: { color: [1, 1, Infinity] } })
  refused({ directional: 3 })
  refused(undefined)
  const height = { baseDensity: 0.1, directional: { exponent: 2, color: [1, 0, 0] as const } }
  assert.deepEqual(validateSceneFog(height), height)
  assert.deepEqual(validateSceneFog({}), {})
  assert.deepEqual(validateSceneFog({ color: GREY, density: 0 }), {
    color: [0.5, 0.5, 0.5],
    density: 0,
    heightFalloff: 0,
    baseHeight: 0,
  })
})
