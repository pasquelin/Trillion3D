// The fog and the light store: the store writes the sun the fog scatters — the one it holds, else
// the first directional light, equal suns told apart by the order of adding —, a fog changed stales
// the frame and the same fog set again does not, and a change of fog alone leaves light transport
// and the bounce probes as they were.
import test from 'node:test'
import assert from 'node:assert/strict'
import { near } from '../../../../math/src/float/near.fixture.ts'
import { createSceneLightStore } from '../light/store.ts'
import { sameSceneAtmosphere, validateSceneAtmosphere } from './atmosphere.ts'
import { coefficientsOf } from './atmosphereOptics.ts'
import { ATMOSPHERE_FLOATS, ATMOSPHERE_SLOT, packAtmosphere } from './atmospherePack.ts'
import { ENVIRONMENT_COEFFICIENTS } from './environment.ts'
import { FOG_SLOT, type SceneFog } from './fog.ts'
import { HEIGHT_FOG_DEFAULTS, heightFogOf, type SceneHeightFog } from './fogHeight.ts'
import {
  mergeModuleParts,
  resolveModuleOption,
  type ModuleOption,
  type ModulePartFields,
} from '../../modules/descriptor.ts'
import { checkSkyOption, resolveSky, SKY_MODULE } from '../../modules/sky/descriptor.ts'
import { DEFAULT_SKY_QUALITY } from '../../modules/sky/quality.ts'

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

/** The merged parts of a sky option written by one source. */
const skyParts = (option: ModuleOption) =>
  mergeModuleParts(SKY_MODULE, [resolveModuleOption(SKY_MODULE, option) as never])

test('the sky module on holds its five parts at the level values; a part switched off is gone', () => {
  const sky = resolveSky(skyParts(true), DEFAULT_SKY_QUALITY)
  const { light, shafts, cloudShadow, direction } = sky.sun!
  assert.deepEqual(
    [light.intensity, light.useTemperature, light.temperatureKelvin, light.angle],
    [6, true, 6500, 0.7357],
  )
  assert.deepEqual(
    [light.shadowDistance, light.shadowsAir, shafts.shaftOcclusion, cloudShadow.shadowsClouds],
    [200, true, true, true],
  )
  assert.ok(Math.abs(Math.hypot(...direction) - 1) < 1e-12 && direction[1] < 0, 'it shines down')
  const fog = sky.fog as { baseDensity: number; baseHeight: number }
  assert.deepEqual([fog.baseDensity, fog.baseHeight], [0.00436, -68.5])
  assert.deepEqual(
    [sky.skyLight!.light.realTimeCapture, sky.skyLight!.light.mobility],
    [true, 'movable'],
  )
  const { reflectionSamplesScale, reflectionShadowSamplesScale } = sky.clouds!.settings
  assert.deepEqual([reflectionSamplesScale, reflectionShadowSamplesScale], [1, 1])
  assert.equal(sky.atmosphere!.planetRadius, validateSceneAtmosphere(true).planetRadius)
  const some = resolveSky(
    skyParts({ clouds: false, heightFog: false, sun: { intensity: 8 } }),
    DEFAULT_SKY_QUALITY,
  )
  assert.deepEqual([some.clouds, some.fog, some.sun!.light.intensity], [undefined, undefined, 8])
})

test('one default per object: `{}` of the module’s height fog is the level’s fog, `{}` of a scene’s own is the component’s', () => {
  const part = (option: boolean | ModulePartFields) =>
    resolveSky(skyParts({ heightFog: option }), DEFAULT_SKY_QUALITY).fog as SceneFog
  // A resolved fog without the keys of the cubemap and the volume that a fog without them leaves undefined.
  const resolved = (fog: SceneFog) => ({ ...heightFogOf(fog as SceneHeightFog) })
  const bare = (fog: SceneHeightFog) => JSON.parse(JSON.stringify(heightFogOf(fog)))
  // The module's part: nothing named, `true` and `{}`, is the fog the level places, 0.0436 of the
  // reference's centimetre numbers at 68.5 m below the origin.
  assert.deepEqual(part({}), part(true))
  assert.deepEqual(part(true), { baseDensity: 0.00436, baseHeight: -68.5 })
  // Naming the level's own numbers changes nothing; naming a density keeps the level's place.
  assert.deepEqual(resolved(part({ baseDensity: 0.00436, baseHeight: -68.5 })), resolved(part({})))
  assert.deepEqual(part({ baseDensity: 0.002 }), { baseDensity: 0.002, baseHeight: -68.5 })
  // A scene's own fog: nothing named is the component's defaults, which naming them changes none of.
  assert.deepEqual(bare({}), HEIGHT_FOG_DEFAULTS)
  assert.deepEqual(bare({ baseDensity: 0.002, falloff: 0.02, baseHeight: 0 }), HEIGHT_FOG_DEFAULTS)
  // The two objects differ by the two numbers the level places, no other.
  const level = JSON.parse(JSON.stringify(resolved(part(true))))
  assert.deepEqual(
    { ...level, baseDensity: HEIGHT_FOG_DEFAULTS.baseDensity, baseHeight: 0 },
    HEIGHT_FOG_DEFAULTS,
  )
})

test('a height fog naming another law takes none of the level numbers, and a refused word changes nothing', () => {
  const sky = resolveSky(
    skyParts({ heightFog: { color: GREY, density: 0.02 } }),
    DEFAULT_SKY_QUALITY,
  )
  assert.deepEqual(sky.fog, { color: GREY, density: 0.02, heightFalloff: 0, baseHeight: 0 })
  assert.throws(() => checkSkyOption({ sun: { nope: 1 } }), /sun/)
  assert.throws(() => checkSkyOption({ heightFog: { maxOpacity: 2 } }), {
    code: 'INVALID_SCENE_ENVIRONMENT',
  })
  assert.throws(() => checkSkyOption({ unknownPart: true }), { code: 'INVALID_MODULE_OPTION' })
  assert.doesNotThrow(() => checkSkyOption(undefined))
})

test('the atmosphere takes every value its settings can hold: a scene that carried a backward-scattering haze or a 12000 km planet loads and is packed', () => {
  const ok = (fields: object) => validateSceneAtmosphere(fields)
  const refused = (fields: object) =>
    assert.throws(() => validateSceneAtmosphere(fields), /atmosphere/)
  // The planet's radius, the air's height and the scale heights above 0; the haze's start from 0.
  for (const planetRadius of [0.05, 12000, 100000]) ok({ planetRadius })
  for (const field of ['planetRadius', 'height', 'rayleighScaleHeight', 'mieScaleHeight'])
    for (const value of [0, -1, NaN]) refused({ [field]: value })
  ok({ height: 0.01, aerialPerspectiveStartDepth: 0 })
  refused({ aerialPerspectiveStartDepth: -0.1 })
  // The haze's anisotropy strictly inside (-1, 1): at |g| = 1 the phase function is 0/0 on the axis.
  for (const mieAnisotropy of [-0.999, -0.3, 0, 0.999]) ok({ mieAnisotropy })
  for (const mieAnisotropy of [-1, 1, 1.5]) refused({ mieAnisotropy })
  // A saved scene carrying both is read again, drawn by the packed block and the sky's parts.
  const saved = { mieAnisotropy: -0.3, planetRadius: 12000 }
  const sky = resolveSky(skyParts({ atmosphere: saved }), DEFAULT_SKY_QUALITY)
  assert.deepEqual([sky.atmosphere!.mieAnisotropy, sky.atmosphere!.planetRadius], [-0.3, 12000])
  const block = packAtmosphere(
    validateSceneAtmosphere(saved),
    [],
    new Float32Array(ATMOSPHERE_FLOATS),
  )
  const planet = ATMOSPHERE_SLOT.planet * 4
  assert.deepEqual(Array.from(block.slice(planet, planet + 3)), [1, 12000, 12060])
  // The air's height under 0.1 km is read as 0.1 km, as the top of the air is made.
  assert.equal(coefficientsOf(validateSceneAtmosphere({ height: 0.01 })).topRadius, 6360.1)
})

test('the planet’s top stands at `groundPosition` on the ground plane: [0, 0] by default, written in its own slot', () => {
  assert.deepEqual(validateSceneAtmosphere(true).groundPosition, [0, 0])
  const placed = validateSceneAtmosphere({ groundPosition: [1500, -2500], groundHeight: 40 })
  assert.deepEqual(placed.groundPosition, [1500, -2500])
  for (const groundPosition of [[1], [1, 2, 3], [0, Infinity], [NaN, 0], 'x'])
    assert.throws(() => validateSceneAtmosphere({ groundPosition } as never), /groundPosition/)
  const block = packAtmosphere(placed, [], new Float32Array(ATMOSPHERE_FLOATS))
  const at = ATMOSPHERE_SLOT.planetPlace * 4
  assert.deepEqual(Array.from(block.slice(at, at + 4)), [1500, -2500, 0, 0])
  assert.equal(
    block[ATMOSPHERE_SLOT.planet * 4 + 3],
    40,
    'the ground’s height is the planet slot’s',
  )
  assert.equal(sameSceneAtmosphere(placed, validateSceneAtmosphere({ groundHeight: 40 })), false)
  assert.equal(
    sameSceneAtmosphere(
      placed,
      validateSceneAtmosphere({ groundPosition: [1500, -2500], groundHeight: 40 }),
    ),
    true,
  )
})

test('an atmosphere holds its light out only if it says so, and is then another air', () => {
  assert.equal(validateSceneAtmosphere(true).holdout, false)
  assert.equal(validateSceneAtmosphere({ holdout: true }).holdout, true)
  assert.throws(() => validateSceneAtmosphere({ holdout: 1 } as never), {
    code: 'INVALID_SCENE_ENVIRONMENT',
  })
  assert.equal(
    sameSceneAtmosphere(validateSceneAtmosphere(true), validateSceneAtmosphere({ holdout: true })),
    false,
  )
})
