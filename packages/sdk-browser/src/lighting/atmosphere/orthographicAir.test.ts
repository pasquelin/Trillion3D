// The air under an orthographic camera: the sky, the haze volume and the haze marched on the surfaces
// start each pixel's ray at the pixel's own point on the near plane, raised by half the view's height,
// and run it along the view's direction; a surface's haze is read at its distance along that
// direction. The programs as shipped, run in JavaScript (`shaderRun`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { Mat } from '../../materials/texture/shaderRunMatrix.fixture.ts'
import { ATMOSPHERE_SLOT } from '../../../../sdk-core/src/scene/core/atmospherePack.ts'
import { hazeProgram } from './hazeWgsl.ts'
import { HAZE_READ_WGSL } from './hazeReadWgsl.ts'
import { VIEW_SLOT } from './layout.ts'
import { opaqueHazeProgram } from './opaqueHazeWgsl.ts'
import { airProgram } from './programs.ts'
import { DEFAULT_AIR_SHAPE } from './shape.ts'
import { skyProgram } from './skyWgsl.ts'

/** The camera's place on the planet (kilometres from its centre) and in the scene (metres). */
const CAMERA = [0, 6361, 0, 6361]
const EYE = [5, 6, 7]

/** The frame's raise of an orthographic view's points: half its 2000 m height, on the planet's up
 *  (`orthographicLift`); none under a perspective view. */
const lift = (orthographic: boolean) => [0, orthographic ? 1000 : 0, 0, 0]

/** A view that looks along -z, 2000 m tall: a pixel's ray leaves the plane of the eye (device depth
 *  1) at `ndc` times 1000 m across and up, and the depth falls to the far plane at `far` metres. */
const sideways = (far: number) => (ndc: number[], z: number) => [
  ndc[0] * 1000 + EYE[0],
  ndc[1] * 1000 + EYE[1],
  EYE[2] - (1 - z) * far,
]

const rays = (perspective: boolean) =>
  shaderRun<{
    airRay: (ndc: number[]) => {
      scene: number[]
      origin: number[]
      dir: number[]
      height: number
    }
  }>(skyProgram(DEFAULT_AIR_SHAPE).code, ['airRay'], {
    frame: { eye: [...EYE, perspective ? 1 : 0], lift: lift(!perspective), camera: CAMERA },
    airUnproject: sideways(1e6),
  }).airRay

test('a perspective view’s rays leave the eye, held over the ground, and pass through their pixels', () => {
  const ray = rays(true)([0.5, 0])
  assert.deepEqual(ray.scene, EYE)
  assert.deepEqual(ray.origin, [0, 6361, 0])
  assert.equal(ray.height, 6361)
  const toward = [500, 0, -5e5]
  const length = Math.hypot(...toward)
  toward.forEach((c, i) => assert.ok(Math.abs(ray.dir[i] - c / length) < 1e-9))
})

test('an orthographic view’s rays leave their pixels’ own points, raised by half the view’s height', () => {
  const at = rays(false)
  const bottom = at([0.5, -1]),
    top = at([-0.5, 1])
  // The point on the near plane, in the scene: the pixel across and up from the eye.
  assert.deepEqual(bottom.scene, [505, -994, 7])
  assert.deepEqual(top.scene, [-495, 1006, 7])
  // On the planet: the camera's place, and the offset of the point from the eye, raised by 1000 m,
  // in kilometres — the bottom pixel starts at the eye's height, the top one 2 km over it.
  const expected = (scene: number[]) => [
    CAMERA[0] + (scene[0] - EYE[0]) / 1000,
    CAMERA[1] + (scene[1] + 1000 - EYE[1]) / 1000,
    CAMERA[2] + (scene[2] - EYE[2]) / 1000,
  ]
  for (const ray of [bottom, top]) {
    expected(ray.scene).forEach((c, i) => assert.ok(Math.abs(ray.origin[i] - c) < 1e-9))
    assert.ok(Math.abs(ray.height - Math.hypot(...ray.origin)) < 1e-9)
    assert.deepEqual(ray.dir, [0, 0, -1], 'one direction for every pixel')
  }
  assert.ok(Math.abs(bottom.origin[1] - CAMERA[1]) < 1e-9)
  assert.ok(Math.abs(top.origin[1] - CAMERA[1] - 2) < 1e-9)
})

/** The frame block of a view, orthographic or not, at the test's eye. */
const airFrame = (orthographic: boolean) => ({
  eye: [...EYE, orthographic ? 0 : 1],
  lift: lift(orthographic),
  camera: CAMERA,
  size: [100, 100, 0.01, 0.01],
  preExposure: [1, 0, 0, 0],
  index: [0, 0, 0, 0],
  hidden: [0, 0, 0, 0],
})

/** The sky pass over `rows` of an orthographic view: the heights its table is read at, pixel by pixel. */
function skyHeights(orthographic: boolean, pixels: number[][]) {
  const heights: number[] = []
  const { skyMain } = shaderRun<{ skyMain: (pixel: number[]) => number[] }>(
    skyProgram(DEFAULT_AIR_SHAPE).code,
    ['skyMain'],
    {
      frame: airFrame(orthographic),
      airUnproject: sideways(1e6),
      flags: { load: () => [0, 0, 0, 0] },
      skyViewTable: {},
      tableSampler: {},
      eyeToTable: (dir: number[]) => dir,
      skyViewUv: (_ground: boolean, _dir: number[], height: number) => (
        heights.push(height),
        [0, 0]
      ),
      textureSampleLevel: () => [1, 1, 1, 1],
      raySphereNearest: () => -1,
      bottomRadius: () => 6360,
      topRadius: () => 6420,
      airSuns: () => ({ count: 0, list: [] }),
      atmo: () => [1, 1, 1, 1],
      fogBeyondAt: () => [0, 0, 0, 1],
    },
  )
  for (const pixel of pixels) skyMain([...pixel, 0, 0])
  return heights
}

test('an orthographic view draws its sky, each pixel read from the height it starts at', () => {
  // The bottom row and the top row of a view 100 pixels tall.
  const [bottom, top] = skyHeights(true, [
    [50, 99.5],
    [50, 0.5],
  ])
  assert.ok(Math.abs(bottom - 6361.0) < 0.02, `bottom ${bottom}`)
  assert.ok(Math.abs(top - 6362.98) < 0.02, `top ${top}`)
})

test('a perspective view’s sky is read from the eye’s height at every pixel, as it was', () => {
  const heights = skyHeights(false, [
    [50, 99.5],
    [50, 0.5],
  ])
  assert.deepEqual(heights, [6361, 6361])
})

/** The haze volume's builder, its first thread's write of the view's block. */
function viewBlock(orthographic: boolean) {
  const atmosphereView = Array.from({ length: 8 }, () => [0, 0, 0, 0])
  const { writeHazeView } = shaderRun<{ writeHazeView: () => void }>(
    hazeProgram(DEFAULT_AIR_SHAPE, false).code,
    ['writeHazeView'],
    {
      frame: {
        eye: [...EYE, orthographic ? 0 : 1],
        lift: lift(orthographic),
        viewProj: new Mat([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
        hidden: [0, 0, 0, 0],
      },
      directLights: { atmosphereView },
      airUnproject: sideways(1e6),
    },
  )
  writeHazeView()
  return atmosphereView
}

test('the haze volume is built for an orthographic view too, and says which kind it is and its direction', () => {
  const perspective = viewBlock(false)
  assert.equal(perspective[VIEW_SLOT.haze][3], 1)
  assert.deepEqual(perspective[VIEW_SLOT.ortho], [0, 0, 0, 0])
  const ortho = viewBlock(true)
  assert.equal(ortho[VIEW_SLOT.haze][3], 2)
  // Along -z, the near plane at z = 7 (the eye's): the offset is the dot of a point of it with that.
  assert.deepEqual(ortho[VIEW_SLOT.ortho], [0, 0, -1, -EYE[2]])
})

/** What a surface at `point` reads of the haze: the depth (kilometres) the volume is read at, for a
 *  volume of `kind`, the direction and offset of an orthographic view in the view block. */
function hazeDepth(kind: number, point: number[]) {
  const depths: number[] = []
  const rows = Array.from({ length: 8 }, () => [0, 0, 0, 0])
  const identity = [
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
  ]
  identity.forEach((column, at) => (rows[VIEW_SLOT.projection + at] = column))
  rows[VIEW_SLOT.haze] = [0, 0, 0, kind]
  rows[VIEW_SLOT.volume] = [8, 8, 8, 32]
  rows[VIEW_SLOT.ortho] = [0, 0, -1, -7]
  const atmosphere = Array.from({ length: ATMOSPHERE_SLOT.planetPlace + 1 }, () => [0, 0, 0, 0])
  const { aerialPerspective } = shaderRun<{
    aerialPerspective: (p: number[], eye: number[]) => number[]
  }>(airProgram({ air: 'read' }, '', [HAZE_READ_WGSL]).code, ['aerialPerspective'], {
    directLights: { atmosphereView: rows, atmosphere },
    hazeWeight: (depth: number) => (depths.push(depth), [0.5, 1]),
    hazeAt: () => [0.1, 0.2, 0.3, 0.4],
  })
  const haze = aerialPerspective(point, EYE)
  return { depths, haze }
}

test('a surface of an orthographic view reads the haze at its distance along the view’s direction', () => {
  // 3007 m ahead of the near plane (z = 7), off to the side and above the eye: the distance is
  // that along the direction, not the straight one from the eye.
  const { depths, haze } = hazeDepth(2, [900, 400, -3000])
  assert.equal(depths.length, 1)
  assert.ok(Math.abs(depths[0] - 3.007) < 1e-9)
  assert.ok(haze[3] < 1, 'the volume is read, not left clear')
})

test('a surface of a perspective view reads it at its straight distance from the eye, as it did', () => {
  const point = [900, 400, -3000]
  const { depths } = hazeDepth(1, point)
  const toEye = Math.hypot(point[0] - EYE[0], point[1] - EYE[1], point[2] - EYE[2])
  assert.ok(Math.abs(depths[0] - toEye * 0.001) < 1e-9)
})

test('a volume that was not built hazes nothing', () => {
  const { depths, haze } = hazeDepth(0, [900, 400, -3000])
  assert.deepEqual(depths, [])
  assert.deepEqual(haze, [0, 0, 0, 1])
})

test('the haze marched on the opaque surfaces is made for an orthographic view too', () => {
  const starts: number[][] = []
  const { opaqueHazeMain } = shaderRun<{ opaqueHazeMain: (pixel: number[]) => number[] }>(
    opaqueHazeProgram(DEFAULT_AIR_SHAPE).code,
    ['opaqueHazeMain'],
    {
      frame: airFrame(true),
      airUnproject: sideways(1e6),
      flags: { load: () => [1, 0, 0, 0] },
      depthTex: { load: () => 0.5 },
      blueNoiseScalar: () => 0.5,
      cloudHaze: (origin: number[]) => (starts.push(origin), [0, 0, 0, 1]),
    },
  )
  opaqueHazeMain([50, 99.5, 0, 0])
  assert.equal(starts.length, 1)
  // The bottom row of the view starts at the eye's height.
  assert.ok(Math.abs(starts[0][1] - CAMERA[1]) < 0.02)
})
