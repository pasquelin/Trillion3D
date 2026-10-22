// The fog volume seen through an orthographic camera (`fogVolumeRun.fixture.ts`'s `orthoCamera`),
// the programs run as shipped (`shaderRun`): parallel rays put a cell's point where its pixel's ray
// reaches its view depth, the depth buffer is linear, the eye's direction is the view's own, the
// history reads the depth from the clip depth, and a surface reads the volume at its pixel and its
// depth along the forward. Split from `fogScatter.test.ts`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { near } from '../../../math/src/float/near.fixture.ts'
import { subtract, unit } from '../../../math/src/vector/vectorTuple.ts'
import { shaderRun } from '../materials/texture/shaderRun.fixture.ts'
import { sliceParams } from './fog/layout.ts'
import { FOG_PROGRAMS } from './fog/programs.ts'
import { fogResourcesWgsl } from './fog/readWgsl.ts'
import {
  EYE,
  GRID,
  depthAtSlice,
  frameScope,
  image,
  orthoCamera,
  phase,
  sliceAtDepth,
  table,
  viewBlockOf,
  type V3,
} from './fogVolumeRun.fixture.ts'
import { CELL, EXTINCTION, G, SUN, scatter, type Light } from './fogScatterRun.fixture.ts'
import { fogRun } from './fogShaderRun.fixture.ts'

const CAMERA = orthoCamera(EYE)
const [HALF_X, HALF_Y] = CAMERA.half

/** The point of a cell of the 20 × 12 × 8 volume the orthographic camera sees, from its box: the pixel's
 *  place on the box, the view depth of the slice along −z. */
function pointOf(cell: V3, offset: V3 = [0.5, 0.5, 0.5]): V3 {
  const p = sliceParams(0.1, 60, 32, GRID.z)
  const depth = depthAtSlice(cell[2] + offset[2], p)
  const ndc = [((cell[0] + offset[0]) / GRID.x) * 2 - 1, 1 - ((cell[1] + offset[1]) / GRID.y) * 2]
  return [EYE[0] + ndc[0] * HALF_X, EYE[1] + ndc[1] * HALF_Y, EYE[2] - depth]
}

test('a cell lies where its pixel’s ray reaches its depth, and its light comes from the view’s own direction', () => {
  const P = pointOf(CELL)
  const centre = [P[0] + 1, P[1] + 2, P[2] + 2]
  const lamp: Light = {
    positionRange: [...centre, 40],
    colorIntensity: [1, 1, 1, 50],
    directionCone: [0, 0, 0, -2],
    params: [0, -1, 0, -2],
    shape: [0, 0, 0, 0],
    capsule: [0, 0, 0, 0],
  }
  const toLamp = subtract(centre, P)
  const d = Math.hypot(...toLamp)
  const window = Math.max(1 - (d / 40) ** 4, 0) ** 2
  // The eye of an orthographic view lies straight behind the point: +z, whatever the point.
  const want = (50 * window * phase(G, unit(toLamp), [0, 0, 1])) / (d * d + 1e-4)
  const got = scatter(CELL, {
    lights: [lamp],
    camera: CAMERA,
    settings: { volumetricFogLampSoftening: 0 },
  })!
  assert.ok(Math.abs(got[0] / (want * EXTINCTION) - 1) < 1e-3, `${got[0]} against ${want}`)
  // The sun scatters by the same phase for every cell: the direction to the eye does not move.
  const sun = (cell: V3) => scatter(cell, { lights: [SUN], sunRank: 0, camera: CAMERA })![0]
  const fromAbove = [1, 0.5, 0.25][0] * 4 * phase(G, [0, 1, 0], [0, 0, 1]) * EXTINCTION
  near([sun(CELL), sun([16, 2, 5])], [fromAbove, fromAbove], 'sun', 1e-6)
})

test('the depth buffer of an orthographic view is linear: a cell’s depth reads back, the far value is the far plane’s', () => {
  const frame = frameScope(image(CAMERA))
  // Depth `d` stores `(100 − d) / 99.9`: 1 at the near plane, 0 at the far.
  const stored = (depth: number) => (100 - depth) / 99.9
  const read = (z: number) =>
    shaderRun<{ fogSceneDepthAt: (pixel: number[]) => number }>(
      FOG_PROGRAMS.scatter,
      ['fogSceneDepthAt'],
      { frame, fogDepth: table(() => z) },
    ).fogSceneDepthAt([5, 5])
  near([read(stored(7.5))], [7.5], 'depth', 1e-4)
  near([read(0)], [100], 'far plane', 1e-3)
})

test('the history of a cell is the cell itself where the view has not moved: its place in the view and its slice', () => {
  const frame = frameScope(image(CAMERA, true, {}, { previous: CAMERA }))
  const run = shaderRun<{
    fogHistoryUV: (P: number[]) => number[]
    fogCellPoint: (cell: number[], offset: number[]) => number[]
  }>(FOG_PROGRAMS.scatter, ['fogHistoryUV', 'fogCellPoint'], { frame })
  for (const cell of [CELL, [0, 0, 0], [19, 11, 7]]) {
    const P = run.fogCellPoint(cell, [0.5, 0.5, 0.5])
    near(P.slice(0, 3), pointOf(cell as V3), `point ${cell}`, 1e-4)
    near(
      run.fogHistoryUV(P.slice(0, 3)),
      [(cell[0] + 0.5) / GRID.x, (cell[1] + 0.5) / GRID.y, (cell[2] + 0.5) / GRID.z],
      `history ${cell}`,
      1e-4,
    )
  }
})

test('a surface reads the volume at its pixel and its depth along the view’s forward', () => {
  const taps: number[][] = []
  const fog = { baseDensity: 0.01, falloff: 0, volumetric: { reach: 20, startAt: 4 } }
  const view = viewBlockOf(image(CAMERA, fog.volumetric))
  const resources = {
    decl: fogResourcesWgsl({ group: 0, volume: 1, sampler: 2 }),
    scope: {
      fogVolume: {},
      fogSampler: {},
      textureSampleLevel: (_t: unknown, _s: unknown, uvw: number[]) => (
        taps.push(uvw),
        [0.1, 0.2, 0.3, 0.5]
      ),
    },
  }
  // The point 6 m to the right, 1 m up, 10 m ahead of an eye that lies elsewhere in the box's plane.
  const toward = [HALF_X * 0.5, HALF_Y * 0.25, -10]
  fogRun<{ fogVolumeLookup: (toward: number[]) => number[] }>(fog, ['fogVolumeLookup'], {
    resources,
    fogView: view,
  }).fogVolumeLookup(toward)
  const p = sliceParams(4, 24, 32, 8)
  const uv = [toward[0] / (2 * HALF_X) + 0.5, 0.5 - toward[1] / (2 * HALF_Y)]
  near(taps[0], [uv[0], uv[1] * (90 / 96), sliceAtDepth(10, p) / 8], 'where', 1e-5)
})
