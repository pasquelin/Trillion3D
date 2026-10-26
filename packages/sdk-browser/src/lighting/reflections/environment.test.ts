// The radiance around the scene a reflection reads, shipped WGSL run as JavaScript (`shaderRun`):
// the sky a ray that leaves the scene reaches (a flat sky light's colour, none without one), and the chain's last stage through a lobe.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { REFLECTION_ENVIRONMENT_WGSL } from './field.ts'
import { REFLECTION_FIELD_STAGE_WGSL } from './wgsl.ts'
import {
  ATMOSPHERE_SLOT,
  ATMOSPHERE_SLOTS,
} from '../../../../sdk-core/src/scene/core/atmospherePack.ts'

const environmentRun = (environment: number[][], surroundings: number[], extra: object = {}) =>
  shaderRun<{
    reflectionEnvironment: (R: number[], rough: number) => number[]
  }>(wgslModule(REFLECTION_ENVIRONMENT_WGSL), ['reflectionEnvironment'], {
    directLights: { environment, atmosphere: [[0, 0, 0, 0]], ...extra },
    reflectionView: { surroundings },
    skyLightApplied: () => false,
    skyLightReflection: () => [0, 0, 0],
    skyLightRay: () => [0, 0, 0],
  })
const zero = () => Array.from({ length: 9 }, () => [0, 0, 0, 0])

test('a ray that leaves a scene with no sky reaches the background the screen draws, whatever light is declared', () => {
  const environment = zero()
  environment[0] = [0.4, 0.2, 0.1, 0]
  const surroundings = [0.25, 0.5, 0.125, 0]
  const run = environmentRun(environment, surroundings)
  for (const R of [
    [0, 1, 0],
    [1, 0, 0],
    [0, -1, 0],
  ])
    assert.deepEqual(run.reflectionEnvironment(R, 0), surroundings.slice(0, 3), `${R}`)
})

/** A sky light's cube as the program reads it: `above` along a direction up, `below` along one down. */
const skyLight = (above = [0, 0, 0], below = [0, 0, 0], shining = true) => ({
  skyLightApplied: () => shining,
  skyLightReflection: (d: number[]) => (d[1] < 0 ? below : above),
  skyLightRay: (d: number[]) => (d[1] < 0 ? below : above),
})
const noSkyLight = skyLight([0, 0, 0], [0, 0, 0], false)
/** The light buffer's air of a scene that shows an atmosphere. */
const air = () => {
  const atmosphere = Array.from({ length: ATMOSPHERE_SLOTS }, () => [0, 0, 0, 0])
  atmosphere[ATMOSPHERE_SLOT.planet] = [1, 6360, 6420, 0]
  return { atmosphere }
}
const skyRun = (
  directLights: object,
  surroundings = [0.25, 0.5, 0.125, 0],
  light: object = noSkyLight,
) =>
  shaderRun<{
    reflectionEnvironment: (R: number[], rough: number) => number[]
    reflectionField: (lobe: { R: number[]; tangent: number; rough: number }) => number[]
    skyProbeRadiance: (d: number[]) => number[]
  }>(
    wgslModule(REFLECTION_FIELD_STAGE_WGSL),
    ['reflectionEnvironment', 'reflectionField', 'skyProbeRadiance'],
    { directLights, reflectionView: { surroundings, light: [40, 0, 0, 0] }, ...light },
  )
const near = (got: number[], want: number[], message: string, tolerance = 1e-9) =>
  got.forEach((c, i) =>
    assert.ok(Math.abs(c - want[i]) < tolerance, `${message}: ${got} ≠ ${want}`),
  )

test('a ray that leaves the scene reaches the sky light’s cube along its direction, and none without a sky light, whatever the air draws', () => {
  const run = skyRun(
    { environment: zero(), atmosphere: [[0, 0, 0, 0]] },
    undefined,
    skyLight([0.2, 0.4, 0.8], [0.01, 0.02, 0.03]),
  )
  near(run.reflectionEnvironment([0.6, 0.8, 0], 0), [0.2, 0.4, 0.8], 'above')
  near(run.reflectionEnvironment([0.6, -0.8, 0], 0.5), [0.01, 0.02, 0.03], 'below')
  const bare = skyRun({ environment: zero(), ...air() })
  near(bare.skyProbeRadiance([0, 1, 0]), [0, 0, 0], 'the probes see no sky without a sky light')
  near(bare.reflectionEnvironment([0, 1, 0], 0), [0, 0, 0], 'a reflection sees none above')
  near(bare.reflectionEnvironment([0, -1, 0], 0), [0, 0, 0], 'nor below')
})

test('the chain’s last stage is the radiance around the scene through the lobe, held to the ceiling of a ray', () => {
  const background = [0.25, 0.5, 0.125, 0]
  const lit = skyRun(
    { environment: zero(), ...air() },
    undefined,
    skyLight([1, 1, 1], [0.5, 0.5, 0.5]),
  )
  const lobe = (R: number[], rough: number) => ({ R, tangent: 0, rough })
  near(lit.reflectionField(lobe([0, 1, 0], 0.3)), lit.reflectionEnvironment([0, 1, 0], 0.3), 'sky')
  const plain = skyRun({ environment: zero(), atmosphere: [[0, 0, 0, 0]] }, background)
  near(plain.reflectionField(lobe([0, 1, 0], 0.3)), background.slice(0, 3), 'the background')
  const blinding = skyRun(
    { environment: zero(), ...air() },
    undefined,
    skyLight([80, 40, 0], [0, 0, 0]),
  )
  near(blinding.reflectionField(lobe([0, 1, 0], 0)), [40, 20, 0], 'its largest channel held to 40')
})
