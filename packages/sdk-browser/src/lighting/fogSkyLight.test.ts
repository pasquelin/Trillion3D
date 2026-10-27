// The sky light in the fog volume (`fogScatterRun.fixture.ts`): scattered only where the scene has one, with
// the fog's colours too, and replaced by the translucency volume's light where the image made one. Split from
// `fogLights.test.ts`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { near } from '../../../math/src/float/near.fixture.ts'
import { subtract, unit } from '../../../math/src/vector/vectorTuple.ts'
import { CAM, EYE, pointOf } from './fogVolumeRun.fixture.ts'
import { CELL, EXTINCTION, G, lit, scatter } from './fogScatterRun.fixture.ts'
import { IRRADIANCE_TERMS } from '../../../sdk-core/src/scene/core/irradianceTerms.ts'
import { SRGB_LUMINANCE } from '../../../math/src/color/color.ts'

test('the sky light scatters only where the scene has one, with the fog’s colours too', () => {
  const sky = [3, 3, 3]
  const whole = lit({ sky })
  assert.ok(whole > 0)
  // The fog's own colour times the ambient harmonic, where the medium is lit by the fog's colours.
  const colours = { sky: [0, 0, 0], fogColor: [0.2, 0.4, 0.6], volumetric: { useFogColors: true } }
  const ambient = IRRADIANCE_TERMS[0].basis
  near(
    scatter(CELL, colours)!.slice(0, 3),
    [0.2, 0.4, 0.6].map((c) => c * ambient * EXTINCTION),
    'colours',
    1e-6,
  )
  assert.equal(lit({ ...colours, skyLight: false }), 0, 'no sky light, no sky term')
  assert.equal(lit({ sky, skyLight: false }), 0)
})

test('where the image made a translucency volume, the cells take its light along the camera vector in the sky light’s place', () => {
  const P = pointOf(CELL)
  const toEye = unit(subtract(EYE, P))
  const cameraVector = toEye.map((c) => -c)
  // The volume: 44 × 25 cells and 24 slices, the slices' law `log2(depth · 1 + 1) · 4`; its ambient light and the weights of the
  // three linear bands.
  const slices = 24
  const law = [1, 1, 4, 0]
  const ambient = [2, 1, 0.5]
  const weights = [0.3, -0.2, 0.5]
  const world = {
    translucencyGi: { grid: [44, 25, slices, 1], z: law },
    giTexels: [ambient, weights] as [number[], number[]],
  }
  // The ambient light times the luminance-normalised colour on the bands: the harmonics' constant term, then the linear bands
  // `weight · colour / luminance` dotted with `(y, z, x)` of the camera vector times the distribution `G`.
  const luminance = ambient.reduce((sum, c, k) => sum + c * SRGB_LUMINANCE[k], 0)
  const along =
    G * (weights[0] * cameraVector[1] + weights[1] * cameraVector[2] + weights[2] * cameraVector[0])
  const want = ambient.map((c) => Math.max(c + (c / (luminance + 1e-5)) * along, 0))
  const taps: number[][] = []
  const got = scatter(CELL, { ...world, sky: [3, 3, 3], giTaps: taps })!
  near(
    got,
    [...want.map((c) => c * EXTINCTION), EXTINCTION],
    'the volume’s light, not the sky’s',
    1e-5,
  )
  // Read at the cell the point lies in: its place in the image and the slice the law gives its depth, the ambient half then the
  // linear half of the stacked slices.
  const clip = [0, 1, 2, 3].map((row) =>
    [...P, 1].reduce((sum, c, k) => sum + c * CAM.viewProj[k * 4 + row], 0),
  )
  const uv = [(clip[0] / clip[3]) * 0.5 + 0.5, (clip[1] / clip[3]) * -0.5 + 0.5]
  const slice = Math.min(Math.max(Math.log2(clip[3] * law[0] + law[1]) * law[2], 0.5), slices - 0.5)
  assert.equal(taps.length, 2)
  near(taps[0], [...uv, slice / (2 * slices)], 'ambient', 1e-5)
  near(taps[1], [...uv, (slice + slices) / (2 * slices)], 'directional', 1e-5)
  // Weights that all point against the camera vector never take the cell below black.
  const against = [cameraVector[1], cameraVector[2], cameraVector[0]].map((c) => -50 * Math.sign(c))
  const dark = scatter(CELL, { ...world, giTexels: [[0.1, 0.1, 0.1], against] })!
  near(dark.slice(0, 3), [0, 0, 0], 'never negative', 0)
  // The volume made none (the cells' last word 0): the sky light lights the cells again.
  const none = scatter(CELL, {
    translucencyGi: { grid: [44, 25, slices, 0], z: law },
    giTexels: world.giTexels,
    sky: [3, 3, 3],
  })!
  near(none, [3 * EXTINCTION, 3 * EXTINCTION, 3 * EXTINCTION, EXTINCTION], 'the sky', 1e-6)
})
