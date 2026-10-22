// The fog volume's light, run as shipped (`shaderRun`) on a volume of 20 × 12 × 8 cells over a view of
// 160 × 90 pixels against the arithmetic written out here (`fogScatterRun.fixture.ts`): what a cell
// scatters of the sun and of its own emission, over what its medium extinguishes; the cell skipped
// behind the surfaces; the history blended in and the history refused. The lamps, the rectangle
// and the sky are `fogLights.test.ts`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { near } from '../../../math/src/float/near.fixture.ts'
import { subtract, unit } from '../../../math/src/vector/vectorTuple.ts'
import { shaderRun } from '../materials/texture/shaderRun.fixture.ts'
import { FOG_PROGRAMS } from './fog/programs.ts'
import { CAM, EYE, GRID, frameScope, image, phase, pointOf, table } from './fogVolumeRun.fixture.ts'
import { CELL, EXTINCTION, G, SUN, scatter } from './fogScatterRun.fixture.ts'

test('a cell scatters the sun by the phase function, what its medium scatters, over what it extinguishes', () => {
  const stored = scatter(CELL, { lights: [SUN], sunRank: 0 })!
  const P = pointOf(CELL)
  const toEye = unit(subtract(EYE, P))
  const light = [1, 0.5, 0.25].map((c) => c * 4 * phase(G, [0, 1, 0], toEye))
  near(stored, [...light.map((l) => l * EXTINCTION), EXTINCTION], 'sun', 1e-6)
  // No sun held, no light: the medium extinguishes and scatters nothing.
  near(scatter(CELL, { lights: [SUN] })!, [0, 0, 0, EXTINCTION], 'no sun', 1e-9)
  // The extinction scales; the particleColor and the medium's own light are the medium's.
  const medium = {
    densityScale: 3,
    particleColor: [0.5, 1, 0.25] as const,
    glow: [100, 0, 50] as const,
  }
  const more = scatter(CELL, { lights: [SUN], sunRank: 0, volumetric: medium })!
  near(
    more,
    [
      light[0] * 0.5 * 3 * EXTINCTION + 1,
      light[1] * 1 * 3 * EXTINCTION,
      light[2] * 0.25 * 3 * EXTINCTION + 0.5,
      3 * EXTINCTION,
    ],
    'medium',
    1e-6,
  )
  // The switch of the medium's own light.
  near(
    scatter(CELL, { volumetric: medium, settings: { volumetricFogGlow: false } })!.slice(0, 3),
    [0, 0, 0],
    'glow off',
    1e-9,
  )
})

test('a cell’s density follows the height fog’s falloff', () => {
  const P = pointOf(CELL)
  near(
    [scatter(CELL, { falloff: 0.05, density: 0.2 })![3]],
    [0.5 * 0.2 * 2 ** (-0.05 * P[1])],
    'falloff',
    1e-7,
  )
})

test('a cell behind every surface of its pixels is not lit; one in front of them is', () => {
  const lit = { lights: [SUN], sunRank: 0, settings: { volumetricFogSkipHidden: true } }
  // The furthest surface of the cell's pixels is nearer than the cell: it is hidden, all zero.
  assert.deepEqual(scatter(CELL, { ...lit, furthest: 0.9 }), [0, 0, 0, 0])
  // The furthest is the sky (device depth 0): the cell is seen.
  assert.ok(scatter(CELL, { ...lit, furthest: 0 })![3] > 0)
})

test('the cells are spread over the view: the last row ends at its bottom edge, not at the pixel the side reaches', () => {
  const run = shaderRun<{ fogCellPoint: (cell: V3, offset: V3) => number[] }>(
    FOG_PROGRAMS.scatter,
    ['fogCellPoint'],
    { frame: frameScope(image(CAM)), directLights: {}, fogDepth: {} },
  )
  // 160 × 90 pixels in cells of 8: 20 × 12, the last row reaching 96 pixels were the cells aligned.
  // The corner of the grid is the corner of the view: the ray there is the ray through ndc (1, −1).
  const corner = run.fogCellPoint([20, 12, 0], [0, 0, 0])
  const depth = corner[3]
  near(
    corner.slice(0, 3),
    [EYE[0] + depth * CAM.half[0], EYE[1] - depth * CAM.half[1], EYE[2] - depth],
    'corner',
    1e-5,
  )
})

test('the depth buffer’s far value reads as the far depth of the sky, a surface’s as its view depth', () => {
  const run = shaderRun<{ fogSceneDepthAt: (pixel: number[]) => number }>(
    FOG_PROGRAMS.scatter,
    ['fogSceneDepthAt'],
    {
      frame: frameScope(image(CAM)),
      // Reversed depth: a surface 5 m ahead of the 0.1 m near plane holds 0.02, the sky 0.
      fogDepth: table(([x]) => (x === 0 ? 0 : 0.1 / 5)),
    },
  )
  // The far depth is one over the fudge added to the reciprocal depth, 10⁻¹³ per centimetre: 10¹¹ metres.
  assert.ok(Math.abs(run.fogSceneDepthAt([0, 0]) / 1e11 - 1) < 1e-6, 'the sky')
  near([run.fogSceneDepthAt([1, 0])], [5], 'a surface', 1e-6)
})

test('the history ends where the previous view’s cells end: a cell it did not cover has none', () => {
  const settings = { volumetricFogUsesHistory: true }
  const drawn: [number, number] = [120, 66]
  const world = { settings, lights: [SUN], sunRank: 0, before: true, previous: [1, 1, 1, 1], drawn }
  // The camera before stood where this cell was seen at 1.2 of its view's width — past its edge.
  const P = pointOf(CELL)
  const depth = EYE[2] - P[2]
  const eye: V3 = [P[0] - 1.4 * depth * CAM.half[0], EYE[1], EYE[2]]
  const sampled: number[][] = []
  const lit = scatter(CELL, { ...world, previousEye: eye, sampled })!
  assert.equal(sampled.length, 0, 'the volume before is not read')
  near(lit, scatter(CELL, { ...world, before: false })!, 'the cell is its own', 1e-9)
  // Where the camera is the same, the cell is in the view, and read.
  scatter(CELL, { ...world, sampled })
  assert.equal(sampled.length, 1)
})

test('the history: the previous volume blended by the weight, read where the cell was', () => {
  const settings = { volumetricFogUsesHistory: true }
  const own = scatter(CELL, { lights: [SUN], sunRank: 0 })!
  // No previous image: the weight is zero and the cell is its own, nothing read.
  const none: number[][] = []
  assert.deepEqual(scatter(CELL, { settings, lights: [SUN], sunRank: 0, sampled: none }), own)
  assert.equal(none.length, 0)
  // A previous image from the same place: the cell reads the volume where its centre was — the same
  // cell, at its centre: the cells lie at multiples of their side in pixels, so the last row, which
  // overhangs the view, is read as it was written — and takes 0.9 of it.
  const sampled: number[][] = []
  const world = {
    settings,
    lights: [SUN],
    sunRank: 0,
    before: true,
    previous: [1, 1, 1, 1],
    sampled,
  }
  const blended = scatter(CELL, world)!
  near(
    blended,
    own.map((v, c) => v * Math.fround(0.1) + [1, 1, 1, 1][c] * Math.fround(0.9)),
    'blend',
    1e-6,
  )
  near(
    sampled[0],
    [(CELL[0] + 0.5) / GRID.x, (CELL[1] + 0.5) / GRID.y, (CELL[2] + 0.5) / GRID.z],
    'where',
    1e-5,
  )
  // With the hidden cells skipped, the previous image's surfaces tell whether its cells were seen: where
  // all four cells around the read lay behind them (their depth is past the cell's) there is no
  // history; where they did not, it is read.
  const kept = {
    ...world,
    sampled: [],
    settings: { ...settings, volumetricFogSkipHidden: true },
  }
  near(scatter(CELL, { ...kept, previousFurthest: 2 })!, own, 'refused', 1e-7)
  const seen: number[][] = []
  near(scatter(CELL, { ...kept, sampled: seen, previousFurthest: 0 })!, blended, 'seen', 1e-7)
  near(seen[0], sampled[0], 'read where it was', 1e-7)
  // The weight is a setting: a lighter history weighs less.
  const light = scatter(CELL, {
    ...world,
    sampled: [],
    settings: { ...settings, volumetricFogHistoryShare: 0.5 },
  })!
  near(
    light,
    own.map((v, c) => v * 0.5 + [1, 1, 1, 1][c] * 0.5),
    'weight',
    1e-6,
  )
})

test('a view drawn smaller than the textures uses fewer cells and reads its history where each cell is', () => {
  const settings = { volumetricFogUsesHistory: true }
  const world = { settings, lights: [SUN], sunRank: 0, before: true, previous: [1, 1, 1, 1] }
  const drawn: [number, number] = [120, 66]
  // 15 × 9 of the 20 × 12 cells are the view's: one past them writes nothing.
  assert.equal(scatter([15, 4, 2], { ...world, drawn }), undefined)
  assert.equal(scatter([3, 9, 2], { ...world, drawn }), undefined)
  // Its history repair reads the previous furthest depth where the cell was: the four texels around
  // the cell's centre of the textures, not where a view-sized scale would put them.
  const loads: number[][] = []
  scatter(CELL, {
    ...world,
    drawn,
    loads,
    settings: { ...settings, volumetricFogSkipHidden: true },
  })
  // (A centre falls on the middle of a texel: the 32-bit rounding puts it on either side.)
  assert.ok(loads.length > 0)
  assert.ok(
    loads.every(([x, y]) => x >= 2 && x <= 4 && y >= 4 && y <= 5),
    JSON.stringify(loads),
  )
  // The cell reads the volume before at its own centre in the textures, as it did at full size.
  const sampled: number[][] = []
  assert.ok(scatter(CELL, { ...world, drawn, sampled }))
  near(
    sampled[0],
    [(CELL[0] + 0.5) / GRID.x, (CELL[1] + 0.5) / GRID.y, (CELL[2] + 0.5) / GRID.z],
    'where',
    1e-5,
  )
})

test('a second layer of fog adds its density to the first’s in the medium', () => {
  near([scatter(CELL, { second: 0.1 })![3]], [2 * EXTINCTION], 'summed', 1e-9)
  near([scatter(CELL, { density: 0, second: 0.1 })![3]], [EXTINCTION], 'alone', 1e-9)
})
