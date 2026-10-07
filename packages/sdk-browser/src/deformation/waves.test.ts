// The same wave read by the physics and by the drawn surface: the GPU deformation
// stage's WGSL, run on the record the frame writes for a mesh the water surface carries, puts
// each rest point within a centimetre of where the physics' `WaterSurface.point` puts it, this
// frame and the last one.
import test from 'node:test'
import assert from 'node:assert/strict'
import { waveShader } from './waves.fixture.ts'
import { createDeformationFrame } from './frame.ts'
import { deformedOf } from './source.ts'
import { recordLayout } from './layout.ts'
import { WaterSurface } from '../../../sdk-core/src/fluids/waterSurface.ts'

const WORLD = { elements: new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]) }

test('the drawn surface stands within a centimetre of the physics surface, now and a frame ago', () => {
  const surface = new WaterSurface({
    level: 0,
    waves: [
      { direction: [1, 0.3], wavelength: 12, amplitude: 0.4, steepness: 0.6 },
      { direction: [-0.2, 1], wavelength: 5, amplitude: 0.15, steepness: 0.5, phase: 1 },
      { direction: [0.7, -0.7], wavelength: 2.5, amplitude: 0.05, steepness: 0.4 },
    ],
  })
  const placed = deformedOf({ waves: surface }, undefined, WORLD)!
  const frame = createDeformationFrame([placed])
  surface.setTime(3.2)
  frame.update(() => false)
  surface.setTime(3.2 + 1 / 60)
  frame.update(() => false)
  const at = frame.bases[0] - 1 + recordLayout(placed.shape).wave
  const deformWaves = waveShader(frame.block)
  const expected = new Float64Array(3)
  let worst = 0
  for (const [time, previous] of [
    [3.2 + 1 / 60, false],
    [3.2, true],
  ] as const) {
    surface.setTime(time)
    for (let x = -40; x <= 40; x += 3.7)
      for (let z = -25; z <= 25; z += 2.9) {
        const d = deformWaves(at, 3, [x, 0, z], previous, false)
        surface.point(x, z, expected)
        worst = Math.max(
          worst,
          Math.hypot(x + d[0] - expected[0], d[1] - expected[1], z + d[2] - expected[2]),
        )
      }
  }
  assert.ok(worst < 0.01, `${worst} m apart`)
})

test('a sheared placement reaches its crest over its least singular value, past its shortest column', () => {
  // A child turned 45° about z under a parent scaled (1, ¼, 1): every column is at least 0.73
  // long, yet a world distance along y comes back 4 times longer in the placement's frame.
  const c = Math.SQRT1_2
  const elements = new Float64Array([c, c / 4, 0, 0, -c, c / 4, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
  const surface = new WaterSurface({
    level: 0,
    waves: [{ direction: [1, 0], wavelength: 8, amplitude: 0.5, steepness: 0.2 }],
  })
  const placed = deformedOf({ waves: surface }, undefined, { elements })!
  const frame = createDeformationFrame([placed])
  frame.update(() => false)
  const model = surface.waveModel,
    crest = model.amplitude[0] + model.lateral[0],
    column = Math.min(...[0, 4, 8].map((k) => Math.hypot(...elements.slice(k, k + 3))))
  assert.ok(Math.abs(frame.reach[0] / (4 * crest) - 1) < 1e-12, `${frame.reach[0]} vs ${4 * crest}`)
  // Every vertex the drawn waves move stays within the reach; the shortest column's would not.
  const at = frame.bases[0] - 1 + recordLayout(placed.shape).wave
  const deformWaves = waveShader(frame.block)
  let farthest = 0
  for (let x = -8; x <= 8; x += 0.05) {
    const d = deformWaves(at, 1, [x * c, (x * c) / 4, 0], false, false)
    // The inverse of the matrix above, applied to the world displacement.
    farthest = Math.max(
      farthest,
      Math.hypot(c * d[0] + 4 * c * d[1], -c * d[0] + 4 * c * d[1], d[2]),
    )
  }
  assert.ok(farthest <= frame.reach[0], `${farthest} > ${frame.reach[0]}`)
  assert.ok(
    farthest > crest / column,
    `the shortest column bounds ${crest / column}, not ${farthest}`,
  )
  // A matrix moved in place is read again.
  elements.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
  frame.update(() => false)
  assert.equal(frame.reach[0], crest)
})
