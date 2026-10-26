import test from 'node:test'
import assert from 'node:assert/strict'
import { validateSceneLight } from './validate.ts'
import { writeLightFields, LIGHT_FIELD } from './fields.ts'
import { sameSceneLight } from './equal.ts'
import { cloneSceneLight } from './clone.ts'
import type { SceneLight } from './contracts.ts'
import { HALF_PI } from '../../../../math/src/constants.ts'
import { near } from '../../../../math/src/float/near.fixture.ts'
import { temperatureFactor } from '../../modules/sky/blackBody.ts'
import { validateSceneAtmosphere } from '../core/atmosphere.ts'
import { ATMOSPHERE_SLOT } from '../core/atmospherePack.ts'
import { diskSolidAngle } from '../core/atmosphereOptics.ts'
import { createSceneLightStore } from './store.ts'
import { baseOf } from './fields.ts'

const source: SceneLight = {
  id: 'disk',
  kind: 'directional',
  color: [1, 1, 1],
  intensity: 1,
  direction: [0, -1, 0],
  castsShadow: true,
}
test('directional source angle is validated, copied and packed in radians', () => {
  const light = validateSceneLight({ ...source, angularRadius: 0.01 })
  const copy = cloneSceneLight(light)
  assert.equal(copy.angularRadius, 0.01)
  const packed = new Float32Array(20)
  writeLightFields(packed, 0, copy)
  assert.equal(packed[LIGHT_FIELD.angularRadius], Math.fround(0.01))
  assert.equal(sameSceneLight(source, light), false)
  assert.equal(validateSceneLight({ ...source, angularRadius: 0 }).angularRadius, 0)
  for (const angle of [-1, NaN, Infinity, HALF_PI])
    assert.throws(() => validateSceneLight({ ...source, angularRadius: angle }), /angularRadius/)
  assert.throws(
    () =>
      validateSceneLight({
        ...source,
        kind: 'point',
        angularRadius: 0.01,
        position: [0, 0, 0],
        range: 10,
      }),
    /angularRadius/,
  )
})

test('the sun’s colour follows its temperature, its disk its tint, and the air reads both and the switches', () => {
  const store = createSceneLightStore()
  store.setEnvironment({ exposure: 1, atmosphere: validateSceneAtmosphere(true) })
  const slot = store.add({
    ...source,
    id: 'sun',
    intensity: 2,
    castsShadow: true,
    useTemperature: true,
    temperatureKelvin: 3000,
    sunDiskTint: [1, 0.5, 0.25],
    shadowsAir: true,
    transmittancePerPixel: true,
  })
  const block = (at: number) => Array.from(store.atmospherePacked.subarray(at * 4, at * 4 + 4))
  const colour = () => Array.from(store.packed.subarray(baseOf(slot) + 4, baseOf(slot) + 7))
  const factor = temperatureFactor(3000)
  const lit = factor.map((c) => 2 * c)
  near(
    block(ATMOSPHERE_SLOT.sunIlluminance).slice(0, 3),
    lit,
    'the illuminance: colour, temperature, intensity',
    1e-5,
  )
  const solid = diskSolidAngle(0.5357 * (Math.PI / 180) * 0.5)
  const disk = block(ATMOSPHERE_SLOT.sunDisk)
  near(
    [0, 1, 2].map((c) => (disk[c] * solid) / lit[c]),
    [1, 0.5, 0.25],
    'the disk: the illuminance tinted, over its solid angle, held by nothing',
    1e-5,
  )
  near(
    block(ATMOSPHERE_SLOT.lightFlags),
    [1, 0, 1, 0],
    'it shades the air, its transmittance per point',
  )
  assert.equal(block(ATMOSPHERE_SLOT.lightSlots)[0], slot, 'its slot in the light buffer')
  near(
    colour(),
    factor,
    'untinted by the air: the surfaces read the transmittance themselves',
    1e-6,
  )
  store.set('sun', { transmittancePerPixel: false })
  assert.ok(colour()[2] < factor[2], 'read once at the ground: the air reddens it')
  store.setAirOn(false)
  near(colour(), factor, 'the atmosphere off: as declared', 1e-6)
  assert.equal(block(ATMOSPHERE_SLOT.planet)[0], 0, 'and no air in the block')
  store.setAirOn(true)
  assert.equal(block(ATMOSPHERE_SLOT.planet)[0], 1)
  for (const bad of [{ sunDiskTint: [1, -1, 1] }, { temperatureKelvin: NaN }, { shadowsAir: 1 }])
    assert.throws(
      () => validateSceneLight({ ...source, ...bad } as never),
      /sunDiskTint|temperatureKelvin|shadowsAir/,
    )
  assert.throws(
    () =>
      validateSceneLight({
        ...source,
        kind: 'point',
        position: [0, 0, 0],
        range: 10,
        shadowsAir: true,
      }),
    /shadowsAir/,
  )
})

test('a sun whose disk is a point draws no disk: a radius of 0 is kept, a cosine of 1 and no luminance', () => {
  const store = createSceneLightStore()
  store.setEnvironment({ exposure: 1, atmosphere: validateSceneAtmosphere(true) })
  store.add({ ...source, id: 'point', angularRadius: 0 })
  // The disk's luminance is the illuminance over its solid angle, which is 0 at a radius of 0: none
  // is written, not an infinity (and a NaN for a channel of 0), and the cosine of its edge is 1.
  assert.equal(diskSolidAngle(0), 0)
  const block = (slot: number) =>
    Array.from(store.atmospherePacked.subarray(slot * 4, slot * 4 + 4))
  assert.deepEqual(block(ATMOSPHERE_SLOT.sunDisk), [0, 0, 0, 1])
  assert.equal(block(ATMOSPHERE_SLOT.sunDirection)[3], 1)
})
