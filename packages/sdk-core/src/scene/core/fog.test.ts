// The fog contract: the environment carries it into the GPU block behind the irradiance,
// a fog changed stales the frame, the same fog set again does not, and a fog out of range is
// refused by name. The height fog's defaults are the converted numbers of the engines that fixed
// them, the extinction form is mapped to its law exactly, and the light store writes the sun the
// fog scatters.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createSceneLightStore } from '../light/store.ts'
import { ENVIRONMENT_COEFFICIENTS, SCENE_ENVIRONMENT_FLOATS } from './environment.ts'
import { FOG_MODE, FOG_SLOT, FOG_SLOTS, packFog, sameSceneFog, validateSceneFog } from './fog.ts'
import { cubemapMipCount, faceAverages } from './fogCubemap.ts'
import { heightFogOf, type SceneHeightFog } from './fogHeight.ts'
import { VOLUMETRIC_FOG_DEFAULTS } from './fogVolumetric.ts'

const GREY = [0.5, 0.5, 0.5] as const

test('the fog block follows the irradiance: colour and mode, then the law and the rest', () => {
  // The fog's block is what `packFog` writes: absent, it zeroes the block and nothing beyond.
  const written = new Float32Array(64).fill(NaN)
  packFog(undefined, written, 0)
  const fogFloats = written.findIndex(Number.isNaN)
  assert.equal(SCENE_ENVIRONMENT_FLOATS, ENVIRONMENT_COEFFICIENTS * 4 + fogFloats)
  // The three literals one fact is written as (the slots, their floats, the environment's), and the
  // order of `FOG_SLOT` the block is laid out by.
  assert.deepEqual([FOG_SLOTS * 4, fogFloats, Object.keys(FOG_SLOT).length], [40, 40, FOG_SLOTS])
  assert.deepEqual(Object.values(FOG_SLOT), [...Array(FOG_SLOTS).keys()])
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
  const written = new Float32Array(FOG_SLOTS * 4).fill(NaN)
  assert.equal(packFog({ baseDensity: 0 }, written, 0)[3], FOG_MODE.none)
  assert.equal(packFog({ maxOpacity: 0 }, written, 0)[3], FOG_MODE.none)
  assert.equal(packFog({ color: GREY, density: 0 }, written, 0)[3], FOG_MODE.none)
  assert.equal(packFog({ baseDensity: 0.001 }, written, 0)[3], FOG_MODE.exponential)
  // A second layer counts: the fog shows where the two densities sum past nothing.
  const second = { baseDensity: 0, secondLayer: { baseDensity: 0.001 } }
  assert.equal(packFog(second, written, 0)[3], FOG_MODE.exponential)
  assert.equal(
    packFog({ ...second, secondLayer: { baseDensity: 0 } }, written, 0)[3],
    FOG_MODE.none,
  )
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

/** A cubemap of one texel a face: six colours. */
const CUBE = { size: 1, texels: new Float32Array(18).fill(0.5), tint: [0.5, 1, 2] as const }

test('the second layer, the end distance, the cubemap and the volume have their slots, none showing by default', () => {
  const slot = (fog: Parameters<typeof packFog>[0], n: number) =>
    Array.from(packFog(fog, new Float32Array(FOG_SLOTS * 4), 0).subarray(n * 4, n * 4 + 4))
  // Off by default: a fog that names none of them writes nothing in them but the second layer's
  // falloff, at no density.
  for (const n of [FOG_SLOT.reach, FOG_SLOT.cubemap, FOG_SLOT.cubeBlend])
    assert.deepEqual(slot({}, n), [0, 0, 0, 0])
  assert.deepEqual(slot({}, FOG_SLOT.second), [0, 0.02, 0, 0].map(Math.fround))
  // The second layer's base is the first's plus its offset; the reach, the end distance first.
  const fog = {
    baseHeight: 4,
    secondLayer: { baseDensity: 0.1, falloff: 0.05, heightShift: 6 },
    horizontalLimit: 80,
  }
  assert.deepEqual(slot(fog, FOG_SLOT.second), [0.1, 0.05, 10, 0].map(Math.fround))
  assert.deepEqual(slot(fog, FOG_SLOT.reach), [80, 0, 0, 0])
  // The volume: its far end the start and the distance, its start, and the switch.
  const volume = slot({ volumetric: { startAt: 5 } }, FOG_SLOT.reach)
  assert.deepEqual(volume, [0, 65, 5, 1])
  assert.deepEqual(slot({ volumetric: { reach: 0 } }, FOG_SLOT.reach), [0, 0, 0, 0])
  // The cubemap: the tint takes the colour's place; its rotation, its levels, its blend by length.
  const big = { size: 4, texels: new Float32Array(288).fill(0.5) }
  const cube = { ...CUBE, ...big, turn: 90, sharpFrom: 100, averageUntil: 20 }
  const withCube = { color: [9, 9, 9] as const, cubemap: cube }
  assert.deepEqual(slot(withCube, FOG_SLOT.color), [0.5, 1, 2, FOG_MODE.exponential])
  const [sin, cos, levels, on] = slot(withCube, FOG_SLOT.cubemap)
  assert.deepEqual(
    [Math.round(sin), Math.round(cos * 1e6), levels, on],
    [1, 0, cubemapMipCount(4), 1],
  )
  assert.deepEqual(slot(withCube, FOG_SLOT.cubeBlend).slice(0, 2), [0.0125, -0.25].map(Math.fround))
})

test('the second layer is held to its bounds at every run, the first as written', () => {
  // Bounds in metres: the density 10 and falloff 2 per 1000 centimetres, ÷ 10.
  const held = heightFogOf({ secondLayer: { baseDensity: 5, falloff: 3, heightShift: -7 } }).second
  assert.deepEqual(held, { baseDensity: 1, falloff: 0.2, heightShift: -7 })
  assert.equal(heightFogOf({ baseDensity: 5 }).baseDensity, 5)
})

test('the cubemap holds levels down to one texel a face, whose colour is the face’s mean', () => {
  assert.deepEqual([1, 2, 4, 5, 64, 100].map(cubemapMipCount), [1, 2, 3, 3, 7, 7])
  const size = 4
  const texels = Float32Array.from({ length: 6 * size * size * 3 }, (_, i) => i)
  const averages = faceAverages({ size, texels })
  assert.equal(averages.length, 18)
  // The smallest level is what the chain of two-by-two box means down to one texel holds.
  const boxes = (level: number[], side: number) =>
    Array.from({ length: (side / 2) ** 2 * 6 * 3 }, (_, k) => {
      const [c, rest] = [k % 3, Math.floor(k / 3)]
      const [x, y, f] = [
        rest % (side / 2),
        Math.floor(rest / (side / 2)) % (side / 2),
        Math.floor(rest / (side / 2) ** 2),
      ]
      const at = (dx: number, dy: number) =>
        level[((f * side + 2 * y + dy) * side + 2 * x + dx) * 3 + c]
      return (at(0, 0) + at(1, 0) + at(0, 1) + at(1, 1)) / 4
    })
  const chain = boxes(boxes(Array.from(texels), 4), 2)
  assert.deepEqual(Array.from(averages), chain)
})

test('the volume is off by default and, on, has the defaults of its numbers', () => {
  assert.equal(heightFogOf({}).volumetric, undefined)
  assert.equal(heightFogOf({ volumetric: false }).volumetric, undefined)
  const v = heightFogOf({ volumetric: true }).volumetric!
  assert.equal(v.anisotropy, VOLUMETRIC_FOG_DEFAULTS.anisotropy)
  assert.deepEqual([v.particleColor, v.farEnd, v.startAt], [[1, 1, 1], 60, 0])
  // The glow is per metre, the engines' number per centimetre, divided by 10 000: × 1/100.
  assert.deepEqual(
    heightFogOf({ volumetric: { glow: [100, 0, 50] } }).volumetric!.glow,
    [1, 0, 0.5],
  )
  // The scatter is held short of ±1; the volume reaches `reach` past its start; no fade is a
  // hundred million per metre.
  const named = heightFogOf({
    volumetric: { anisotropy: 5, startAt: 10, fadeInLength: 4 },
  })
  assert.deepEqual(
    [named.volumetric!.anisotropy, named.volumetric!.farEnd, named.volumetric!.fadeInRate],
    [0.99, 70, 0.25],
  )
  assert.equal(v.fadeInRate, 1e8)
  // What the block does not hold still tells two fogs apart: the particles' colour, and the cubemap's picture.
  assert.equal(
    sameSceneFog({ volumetric: true }, { volumetric: { particleColor: [1, 1, 0.5] } }),
    false,
  )
  assert.equal(sameSceneFog({ volumetric: true }, { volumetric: {} }), true)
  assert.equal(
    sameSceneFog({ cubemap: CUBE }, { cubemap: { ...CUBE, texels: CUBE.texels.slice() } }),
    false,
  )
  assert.equal(sameSceneFog({ cubemap: CUBE }, { cubemap: { ...CUBE } }), true)
})

test('a fog that holds out is another fog, and the switch is checked', () => {
  assert.equal(sameSceneFog({ holdout: true }, {}), false)
  assert.equal(sameSceneFog({ holdout: false }, {}), true)
  assert.throws(() => validateSceneFog({ holdout: 'yes' } as never), {
    code: 'INVALID_SCENE_ENVIRONMENT',
  })
  assert.equal((validateSceneFog({ holdout: true }) as { holdout: boolean }).holdout, true)
})

test('the new fields are refused by name where out of range', () => {
  const refused = (fog: unknown) =>
    assert.throws(() => validateSceneFog(fog as never), { code: 'INVALID_SCENE_ENVIRONMENT' })
  refused({ secondLayer: { baseDensity: -1 } })
  refused({ secondLayer: { falloff: Number.NaN } })
  refused({ secondLayer: { heightShift: Infinity } })
  refused({ secondLayer: 3 })
  refused({ horizontalLimit: -1 })
  refused({ cubemap: { size: 2, texels: new Float32Array(3) } })
  refused({ cubemap: { size: 0, texels: [] } })
  // Past the size a face may have, the picture is refused whatever its texels: the buffer a device holds.
  refused({ cubemap: { size: 2048, texels: new Float32Array(6 * 2048 * 2048 * 3) } })
  refused({ cubemap: { ...CUBE, turn: 361 } })
  refused({ cubemap: { ...CUBE, tint: [1, 1] } })
  refused({ cubemap: { size: 1, texels: new Float32Array(18).fill(-1) } })
  refused({ volumetric: { particleColor: [2, 1, 1] } })
  refused({ volumetric: { reach: -5 } })
  refused({ volumetric: { useFogColors: 1 } })
  refused({ volumetric: 'yes' })
  const kept = {
    secondLayer: { baseDensity: 5 },
    horizontalLimit: 10,
    cubemap: CUBE,
    volumetric: true,
  }
  const done = validateSceneFog(kept) as typeof kept
  // A density past the bound is held, not refused; the picture is kept, not copied.
  assert.equal(done.secondLayer.baseDensity, 5)
  assert.equal(done.cubemap.texels, CUBE.texels)
  assert.equal((validateSceneFog({ volumetric: false }) as SceneHeightFog).volumetric, false)
})
