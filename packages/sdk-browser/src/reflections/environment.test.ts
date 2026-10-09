// The radiance around the scene a reflection reads, shipped WGSL run as JavaScript (`shaderRun`):
// the GGX lobe's zonal moments over the environment's bands, the surroundings added whole, and the
// background as the display shows it standing in for a scene that declares no light around it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../math/src/wgsl/assemble.ts'
import { REFLECTION_ENVIRONMENT_WGSL } from './wgsl.ts'
import { SURROUNDINGS_SHADER } from './gpu.ts'
import { TONE_MAPPING_WGSL } from '../lighting/toneMappingWgsl.ts'
import { TONE_MAPPING_RANK } from '../../../sdk-core/src/scene/core/environment.ts'
import { linearToSrgb, srgbToLinear } from '../../../math/src/color/color.ts'

test('the GGX lobe keeps a mirror whole and filters the higher bands as it roughens', () => {
  const { reflectionBands } = shaderRun<{ reflectionBands: (rough: number) => number[] }>(
    wgslModule(REFLECTION_ENVIRONMENT_WGSL),
    ['reflectionBands'],
    {},
  )
  const mirror = reflectionBands(0.0525)
  assert.equal(mirror[0], 1)
  assert.ok(mirror[1] > 0.999 && mirror[2] > 0.999)
  let last = mirror
  for (const rough of [0.2, 0.4, 0.6, 0.8, 1]) {
    const bands = reflectionBands(rough)
    assert.equal(bands[0], 1)
    assert.ok(bands[1] < last[1] && bands[2] < last[2], `filtered more at ${rough}`)
    assert.ok(bands[2] < bands[1], 'the quadratic band filtered more than the linear one')
    last = bands
  }
})

test('the surroundings add to the environment whole, at every roughness', () => {
  const directLights = { environment: Array.from({ length: 9 }, () => [0, 0, 0, 0]) }
  directLights.environment[0] = [0.4, 0.2, 0.1, 0]
  const view = { surroundings: [0.25, 0.5, 0.125, 0] }
  const run = (surroundings: number[]) =>
    shaderRun<{ reflectionEnvironment: (R: number[], rough: number) => number[] }>(
      wgslModule(REFLECTION_ENVIRONMENT_WGSL),
      ['reflectionEnvironment', 'reflectionBands'],
      { directLights, reflectionView: { surroundings } },
    )
  for (const rough of [0.05, 0.5, 1])
    for (const R of [
      [0, 1, 0],
      [0.6, 0, 0.8],
    ]) {
      const bare = run([0, 0, 0, 0]).reflectionEnvironment(R, rough)
      const lit = run(view.surroundings).reflectionEnvironment(R, rough)
      for (let c = 0; c < 3; c++)
        assert.ok(Math.abs(lit[c] - bare[c] - view.surroundings[c]) < 1e-12)
    }
})

test('a scene with no light around it is surrounded by its background, as the display shows it', () => {
  const view = {
    counts: [0, TONE_MAPPING_RANK.aces, 0, 0],
    // The background 0x171d28 displayed, in linear, and an exposure of 2.
    display: [...[0x17, 0x1d, 0x28].map((b) => srgbToLinear(b / 255)), 2],
    surroundings: [9, 9, 9, 9],
  }
  const environment = Array.from({ length: 9 }, () => [0, 0, 0, 0])
  const run = shaderRun<{ reflectionSurroundings: () => void; aces: (c: number[]) => number[] }>(
    SURROUNDINGS_SHADER + wgslModule(TONE_MAPPING_WGSL),
    [
      'reflectionSurroundings',
      'toneUnmap',
      'acesInverse',
      'cineonInverse',
      'agxInverse',
      'neutralInverse',
      'aces',
    ],
    { directLights: { environment }, view },
  )
  run.reflectionSurroundings()
  // A mirror (its weight one) shows it through the exposure and the curve: the background's bytes.
  const shown = run.aces(view.surroundings.slice(0, 3).map((c) => c * 2))
  assert.deepEqual(
    shown.map((c) => Math.round(linearToSrgb(c) * 255)),
    [0x17, 0x1d, 0x28],
  )
  // A scene that declares light around it — one coefficient — answers alone.
  environment[3] = [0, 0.1, 0, 0]
  run.reflectionSurroundings()
  assert.deepEqual(view.surroundings, [0, 0, 0, 0])
})
