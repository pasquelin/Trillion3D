// The radiance around the scene a reflection reads, shipped WGSL run as JavaScript (`shaderRun`):
// the GGX lobe's zonal moments over a radiance field's bands (the probes' field reads through it),
// the sky a ray that leaves the scene reaches (the atmosphere's table by direction, a flat sky
// light's colour), the background the screen draws where there is none, as the display shows it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { REFLECTION_ENVIRONMENT_WGSL, REFLECTION_LOBE_WGSL } from './field.ts'
import { REFLECTION_FIELD_OVER_WGSL } from './wgsl.ts'
import { SKY_RAYS } from '../atmosphere/layout.ts'
import { SKY_RAYS_PROGRAM } from '../atmosphere/skyRaysWgsl.ts'
import { validateSceneAtmosphere } from '../../../../sdk-core/src/scene/core/atmosphere.ts'
import { fromHalf, toHalf } from '../../../../math/src/float/half.ts'
import {
  ATMOSPHERE_FLOATS,
  ATMOSPHERE_SLOT,
  packAtmosphere,
} from '../../../../sdk-core/src/scene/core/atmospherePack.ts'
import { SKY_SLOT, SKY_SLOTS } from '../../../../sdk-core/src/scene/core/environmentSky.ts'
import { lobeRadianceShader } from '../../../../sdk-core/src/scene/core/irradianceBasis.ts'
import { IRRADIANCE_TERMS } from '../../../../sdk-core/src/scene/core/irradianceTerms.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { DISPLAY_VALUE_WGSL } from '../toneMappingWgsl.ts'
import { TONE_MAPPING_RANK } from '../../../../sdk-core/src/scene/core/environment.ts'
import { linearToSrgb } from '../../../../math/src/color/color.ts'
import { createSurroundings } from '../toneUnmap.ts'
import type { Lobe } from './scene.fixture.ts'

/** An order-2 field's radiance through a lobe, as the probes' field reads it (`lobeRadianceShader`
 *  over `REFLECTION_LOBE_WGSL`), here over the coefficients `environment`. */
const FIELD_THROUGH_LOBE = wgslBlock(
  'FIELD_THROUGH_LOBE',
  [REFLECTION_LOBE_WGSL],
  `fn fieldThrough(lobe:ReflectionLobe)->vec3f{return ${lobeRadianceShader((k) => `directLights.environment[${k}].rgb`, 'lobe')};}`,
)
const environmentRun = (environment: number[][], surroundings: number[], extra: object = {}) =>
  shaderRun<{
    reflectionBands: (alpha: number) => number[]
    reflectionLobeOf: (R: number[], alpha: number, lobe: number[]) => Lobe
    reflectionEnvironment: (R: number[]) => number[]
    fieldThrough: (lobe: Lobe) => number[]
  }>(
    wgslModule(REFLECTION_ENVIRONMENT_WGSL, FIELD_THROUGH_LOBE),
    [
      'reflectionEnvironment',
      'fieldThrough',
      'reflectionLobeOf',
      'reflectionBands',
      'reflectionConeTangent',
    ],
    {
      directLights: { environment, ...extra },
      reflectionView: { surroundings },
    },
  )
const zero = () => Array.from({ length: 9 }, () => [0, 0, 0, 0])

test('the GGX lobe keeps a mirror whole and filters the higher bands as it widens', () => {
  const { reflectionBands } = environmentRun(zero(), [0, 0, 0, 0])
  let last = reflectionBands(0.0525 ** 2)
  assert.ok(last[0] > 0.999 && last[1] > 0.999)
  for (const rough of [0.2, 0.4, 0.6, 0.8, 1]) {
    const bands = reflectionBands(rough * rough)
    assert.ok(bands[0] < last[0] && bands[1] < last[1], `filtered more at ${rough}`)
    assert.ok(bands[1] < bands[0], 'the quadratic band filtered more than the linear one')
    last = bands
  }
})

test('a ray that leaves a scene with no sky reaches the background the screen draws, whatever light is declared', () => {
  const environment = zero()
  environment[0] = [0.4, 0.2, 0.1, 0]
  const surroundings = [0.25, 0.5, 0.125, 0]
  const run = environmentRun(environment, surroundings, { sky: skyBlock() })
  for (const R of [
    [0, 1, 0],
    [1, 0, 0],
    [0, -1, 0],
  ])
    assert.deepEqual(run.reflectionEnvironment(R), surroundings.slice(0, 3), `${R}`)
})

test('a stretched lobe filters each axis by its own width, a round one is the zonal convolution', () => {
  // L(ω) = 2 + (3(a·ω)² − 1) along an axis a, in the engine's harmonics (constant, x² − y², and
  // 3z² − 1): its mean over a lobe of second moments E[ωωᵀ] is 2 + 3·E[(a·ω)²] − 1. Each axis keeps
  // the variance of the round lobe of its width, σ² = (1 − a₂)/3, so along the long axis T the
  // field reads 2 − a₂(αt), across it 2 − a₂(α), and along R 2 + a₂(α) + a₂(αt).
  const basis = (k: number) => IRRADIANCE_TERMS[k].basis
  const field = (difference: number, zonal: number) => {
    const environment = zero()
    environment[0] = [2 / basis(0), 0, 0, 0]
    environment[8] = [difference / basis(8), 0, 0, 0]
    environment[6] = [zonal / basis(6), 0, 0, 0]
    return environmentRun(environment, [0, 0, 0, 0])
  }
  const alongX = field(1.5, -0.5),
    alongY = field(-1.5, -0.5),
    alongZ = field(0, 1)
  const R = [0, 0, 1]
  const { reflectionBands } = alongX
  for (const [alpha, long] of [
    [0.04, 0.04],
    [0.1, 0.75],
    [0.3, 0.9],
  ]) {
    const short = reflectionBands(alpha)[1],
      stretched = reflectionBands(long)[1]
    const read = (run: typeof alongX) =>
      run.fieldThrough(run.reflectionLobeOf(R, alpha, [1, 0, 0, long]))[0]
    assert.ok(Math.abs(read(alongX) - (2 - stretched)) < 1e-9, `T ${alpha} ${long}`)
    assert.ok(Math.abs(read(alongY) - (2 - short)) < 1e-9, `B ${alpha} ${long}`)
    assert.ok(Math.abs(read(alongZ) - (2 + short + stretched)) < 1e-9, `R ${alpha} ${long}`)
  }
})

test('a scene is surrounded by its background, as the display shows it, declared light or none', () => {
  // The background 0x171d28 as the display shows it, the curve and an exposure of 2: the
  // surroundings the view writes (`createSurroundings`).
  const surroundings = createSurroundings()(0x171d28, 2, TONE_MAPPING_RANK.aces)
  const { aces } = shaderRun<{ aces: (c: number[]) => number[] }>(
    wgslModule(DISPLAY_VALUE_WGSL),
    ['aces'],
    {},
  )
  // A mirror (its weight one) shows it through the exposure and the curve: the background's bytes.
  const shown = aces([...surroundings.slice(0, 3)].map((c) => c * 2))
  assert.deepEqual(
    shown.map((c) => Math.round(linearToSrgb(c) * 255)),
    [0x17, 0x1d, 0x28],
  )
})

/** The sky's block (`SKY_SLOTS` `vec4`): `upper`, its `w` 1 where a sky light gives the probes the
 *  sky, and `lower`, its `w` 1 where the scene shows a sky; nothing by default. */
const skyBlock = (upper = [0, 0, 0, 0], lower = [0, 0, 0, 0]) => {
  const sky = Array.from({ length: SKY_SLOTS }, () => [0, 0, 0, 0])
  sky[SKY_SLOT.upper] = upper
  sky[SKY_SLOT.lower] = lower
  return sky
}
const { azimuth: AZIMUTH, elevation: ELEVATION } = SKY_RAYS
const unpackHalves = (word: number) => [fromHalf(word & 0xffff), fromHalf(word >>> 16)]
/** A texel of the sky by direction: its three half floats in two words. */
const texel = (column: number, row: number) => [row / 8, column / 64, 0.5]
const word = ([r, g, b]: number[]) => [((toHalf(r) | (toHalf(g) << 16)) >>> 0) as number, toHalf(b)]
const air = () => {
  const atmosphere = Array.from({ length: 13 }, () => [0, 0, 0, 0])
  atmosphere[ATMOSPHERE_SLOT.planet] = [1, 6360, 6420, 0]
  const skyRays = Array.from({ length: AZIMUTH * ELEVATION }, (_, i) =>
    word(texel(i % AZIMUTH, Math.floor(i / AZIMUTH))),
  )
  return { atmosphere, skyRays }
}
const skyRun = (directLights: object, surroundings = [0.25, 0.5, 0.125, 0]) =>
  shaderRun<{
    reflectionEnvironment: (R: number[]) => number[]
    reflectionFieldOver: (gathered: number[], R: number[]) => number[]
    skyRadiance: (d: number[]) => number[]
    skyProbeRadiance: (d: number[]) => number[]
    skyRaysDirection: (texel: number[]) => number[]
    skyRaysCoordinates: (d: number[]) => number[]
  }>(
    wgslModule(REFLECTION_FIELD_OVER_WGSL),
    [
      'reflectionEnvironment',
      'reflectionFieldOver',
      'skyRadiance',
      'skyProbeRadiance',
      'skyRaysDirection',
      'skyRaysCoordinates',
    ],
    { directLights, reflectionView: { surroundings } },
  )
const near = (got: number[], want: number[], message: string, tolerance = 1e-9) =>
  got.forEach((c, i) =>
    assert.ok(Math.abs(c - want[i]) < tolerance, `${message}: ${got} ≠ ${want}`),
  )

test('a ray that leaves the scene reaches the sky along its direction: a flat colour above the horizon, the ground below', () => {
  const sky = skyBlock([0.2, 0.4, 0.8, 1], [0.01, 0.02, 0.03, 1])
  const run = skyRun({ environment: zero(), sky, atmosphere: [[0, 0, 0, 0]], skyRays: [] })
  near(run.reflectionEnvironment([0.6, 0.8, 0]), [0.2, 0.4, 0.8], 'above')
  near(run.reflectionEnvironment([0.6, -0.8, 0]), [0.01, 0.02, 0.03], 'below')
  // A sky of the air alone, no sky light: a reflection sees it, the probes none.
  const bare = skyRun({ environment: zero(), sky: skyBlock([1, 1, 1, 0], [0, 0, 0, 1]), ...air() })
  near(bare.skyProbeRadiance([0, 1, 0]), [0, 0, 0], 'the probes see no sky without a sky light')
  assert.ok(
    bare.reflectionEnvironment([0, 1, 0]).every((c) => c > 0),
    'a reflection sees it',
  )
})

test('the sky by direction is read as the atmosphere wrote it: the texel on its centre, the four around between', () => {
  const run = skyRun({ environment: zero(), sky: skyBlock([2, 1, 1, 1], [0, 0, 0, 1]), ...air() })
  const factor = [2, 1, 1]
  for (const [column, row] of [
    [0, 0],
    [37, 20],
    [AZIMUTH - 1, ELEVATION - 1],
  ]) {
    const d = run.skyRaysDirection([column, row])
    const [x, y] = run.skyRaysCoordinates(d)
    near([x, y], [column, row], `coordinates of ${column},${row}`, 1e-6)
    near(
      run.skyRadiance(d),
      texel(column, row).map((c, i) => c * factor[i]),
      `texel ${column},${row}`,
      1e-6,
    )
  }
  // Midway between two rows, the same column: the mean of the two.
  const [row, column] = [30, 11]
  const phi = ((column + 0.5) / AZIMUTH - 0.5) * 2 * Math.PI
  const y = ((row + 1) / ELEVATION) ** 2
  const ring = Math.sqrt(1 - y * y)
  const between = run.skyRadiance([ring * Math.cos(phi), y, ring * Math.sin(phi)])
  near(between, [(2 * (row + 0.5)) / 8, column / 64, 0.5], 'between two rows', 1e-6)
  // The azimuth wraps: the seam at 180° is the mean of the last column and the first.
  const seam = run.skyRadiance([-ring, y, 0])
  near(seam, [(2 * (row + 0.5)) / 8, (AZIMUTH - 1) / 64 / 2, 0.5], 'the seam', 1e-4)
})

test('the probes hold the sky where a sky light gives it, so the field never adds it twice', () => {
  const background = [0.25, 0.5, 0.125, 0]
  const lit = skyRun({
    environment: zero(),
    sky: skyBlock([1, 1, 1, 1], [0.5, 0.5, 0.5, 1]),
    ...air(),
  })
  const R = [0, 1, 0]
  const environment = lit.reflectionEnvironment(R)
  const probes = [0.3, 0.2, 0.1]
  // The probes answer the whole: their radiance alone. None: the environment alone. A part: a mix.
  near(lit.reflectionFieldOver([...probes, 1], R), probes, 'answered whole')
  near(lit.reflectionFieldOver([...probes, 0], R), environment, 'unanswered')
  near(
    lit.reflectionFieldOver([...probes, 0.25], R),
    environment.map((c, i) => 0.75 * c + 0.25 * probes[i]),
    'a quarter',
  )
  // Without a sky light the probes hold no sky: the environment stays under them, as it always was.
  const plain = skyRun(
    { environment: zero(), sky: skyBlock([0, 0, 0, 0]), atmosphere: [[0, 0, 0, 0]] },
    background,
  )
  near(
    plain.reflectionFieldOver([...probes, 1], R),
    probes.map((c, i) => c + background[i]),
    'under',
  )
})

test('the atmosphere writes the sky by direction where the readers find it, brighter toward the sun', () => {
  // The sun 45° up toward +x, the air's tables stood in by clear ones: the program is run as shipped.
  const toSun = [Math.SQRT1_2, Math.SQRT1_2, 0]
  const block = new Float32Array(ATMOSPHERE_FLOATS)
  packAtmosphere(
    validateSceneAtmosphere(true),
    {
      direction: toSun.map((c) => -c),
      illuminance: [10, 10, 10],
      angularRadius: 0.00467,
    },
    [1, 1, 1],
    block,
  )
  const atmosphere = Array.from({ length: 13 }, (_, i) =>
    Array.from(block.subarray(i * 4, i * 4 + 4)),
  )
  const skyRays: number[][] = Array.from({ length: AZIMUTH * ELEVATION }, () => [0, 0])
  const { skyRaysMain } = shaderRun<{ skyRaysMain: (id: number[]) => void }>(
    SKY_RAYS_PROGRAM.code,
    ['skyRaysMain'],
    {
      directLights: { atmosphere, skyRays },
      transmittanceAt: () => [1, 1, 1],
      multiScatterAt: () => [0, 0, 0],
    },
  )
  const row = 40
  // The middle column faces +x, the sun's side; the first looks the other way, the far side of the sky.
  const [sunSide, farSide] = [AZIMUTH / 2, 0]
  for (const column of [sunSide, farSide]) skyRaysMain([column, row, 0])
  const read = (column: number) => {
    const [a, b] = skyRays[row * AZIMUTH + column].map(unpackHalves)
    return [...a, b[0]]
  }
  const [toward, away] = [read(sunSide), read(farSide)]
  assert.ok(toward.every((c) => c > 0) && away.every((c) => c > 0), 'a lit sky, in every channel')
  assert.ok(toward[0] > away[0], 'the sky is brighter toward the sun')
  // What a reader finds in the table is that radiance: the texel on its centre, the factor one.
  const reader = skyRun({ environment: zero(), sky: skyBlock([1, 1, 1, 1]), ...air(), skyRays })
  near(
    reader.skyRadiance(reader.skyRaysDirection([sunSide, row])),
    toward,
    'read back',
    1e-3 * toward[0],
  )
})
