// The radiance around the scene a reflection reads, and the frame's state, shipped WGSL run as JavaScript (`shaderRun`):
// the GGX lobe's zonal moments over the environment's bands, the surroundings added whole, and the
// background as the display shows it standing in for a scene that declares no light around it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../math/src/wgsl/assemble.ts'
import { REFLECTION_ENVIRONMENT_WGSL } from './field.ts'
import { BEGIN_SHADER } from './trace.ts'
import { DISPLAY_VALUE_WGSL } from '../lighting/toneMappingWgsl.ts'
import { TONE_MAPPING_RANK } from '../../../sdk-core/src/scene/core/environment.ts'
import { linearToSrgb } from '../../../math/src/color/color.ts'

type Lobe = { R: number[]; T: number[]; bands: number[]; widths: number[] }
const environmentRun = (environment: number[][], surroundings: number[]) =>
  shaderRun<{
    reflectionBands: (alpha: number) => number[]
    reflectionLobeOf: (R: number[], alpha: number, lobe: number[]) => Lobe
    reflectionEnvironment: (lobe: Lobe) => number[]
  }>(
    wgslModule(REFLECTION_ENVIRONMENT_WGSL),
    ['reflectionEnvironment', 'reflectionLobeOf', 'reflectionBands'],
    {
      directLights: { environment },
      reflectionView: { surroundings },
      ReflectionLobe: (R: number[], T: number[], bands: number[], widths: number[]) => ({
        R,
        T,
        bands,
        widths,
      }),
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

test('the surroundings add to the environment whole, through every lobe', () => {
  const environment = zero()
  environment[0] = [0.4, 0.2, 0.1, 0]
  const surroundings = [0.25, 0.5, 0.125, 0]
  const bare = environmentRun(environment, [0, 0, 0, 0])
  const lit = environmentRun(environment, surroundings)
  for (const [alpha, long] of [
    [0.0025, 0.0025],
    [0.25, 0.25],
    [0.1, 0.75],
  ])
    for (const R of [
      [0, 1, 0],
      [0.6, 0, 0.8],
    ]) {
      const lobe = [1, 0, 0, long]
      const without = bare.reflectionEnvironment(bare.reflectionLobeOf(R, alpha, lobe))
      const with_ = lit.reflectionEnvironment(lit.reflectionLobeOf(R, alpha, lobe))
      for (let c = 0; c < 3; c++)
        assert.ok(Math.abs(with_[c] - without[c] - surroundings[c]) < 1e-12)
    }
})

test('a stretched lobe filters each axis by its own width, a round one is the zonal convolution', () => {
  // L(ω) = 2 + (3(a·ω)² − 1) along an axis a, in the engine's harmonics (constant, x² − y², and
  // 3z² − 1): its mean over a lobe of second moments E[ωωᵀ] is 2 + 3·E[(a·ω)²] − 1. Each axis keeps
  // the variance of the round lobe of its width, σ² = (1 − a₂)/3, so along the long axis T the
  // field reads 2 − a₂(αt), across it 2 − a₂(α), and along R 2 + a₂(α) + a₂(αt).
  const basis = { constant: 0.2820948, z: 0.3153916, xy: 0.5462742 }
  const field = (difference: number, zonal: number) => {
    const environment = zero()
    environment[0] = [2 / basis.constant, 0, 0, 0]
    environment[8] = [difference / basis.xy, 0, 0, 0]
    environment[6] = [zonal / basis.z, 0, 0, 0]
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
      run.reflectionEnvironment(run.reflectionLobeOf(R, alpha, [1, 0, 0, long]))[0]
    assert.ok(Math.abs(read(alongX) - (2 - stretched)) < 1e-9, `T ${alpha} ${long}`)
    assert.ok(Math.abs(read(alongY) - (2 - short)) < 1e-9, `B ${alpha} ${long}`)
    assert.ok(Math.abs(read(alongZ) - (2 + short + stretched)) < 1e-9, `R ${alpha} ${long}`)
  }
})

test('a scene with no light around it is surrounded by its background, as the display shows it', () => {
  // The lighting's view: the background 0x171d28 as the display shows it, the curve and an exposure
  // of 2; the reflection's own, whose surroundings the begin writes.
  const view = {
    background: [...[0x17, 0x1d, 0x28].map((b) => b / 255), 1],
    display: [TONE_MAPPING_RANK.aces, 0, 0, 0],
    lightParams: [0, 0, 0, 2],
  }
  const reflectionView = { surroundings: [9, 9, 9, 9] }
  const environment = Array.from({ length: 9 }, () => [0, 0, 0, 0])
  const work = [7, 0, 0, 0]
  const run = shaderRun<{ reflectionBegin: () => void; aces: (c: number[]) => number[] }>(
    BEGIN_SHADER + wgslModule(DISPLAY_VALUE_WGSL),
    [
      'reflectionBegin',
      'toneUnmap',
      'acesInverse',
      'cineonInverse',
      'agxInverse',
      'neutralInverse',
      'aces',
      'srgbToLinear',
    ],
    { directLights: { environment }, view, reflectionView, work },
  )
  run.reflectionBegin()
  // A mirror (its weight one) shows it through the exposure and the curve: the background's bytes.
  const shown = run.aces(reflectionView.surroundings.slice(0, 3).map((c) => c * 2))
  assert.deepEqual(
    shown.map((c) => Math.round(linearToSrgb(c) * 255)),
    [0x17, 0x1d, 0x28],
  )
  // A scene that declares light around it — one coefficient — answers alone.
  environment[3] = [0, 0.1, 0, 0]
  run.reflectionBegin()
  assert.deepEqual(reflectionView.surroundings, [0, 0, 0, 0])
  // The tile list starts empty: its indirect arguments, one row of nothing, then 1, and the count.
  assert.deepEqual(work, [0, 1, 1, 0])
})
