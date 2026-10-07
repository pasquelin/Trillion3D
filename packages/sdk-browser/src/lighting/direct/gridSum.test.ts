// The lighting of a pixel on the light grid equals the sum over every light, bit for bit. The
// shipped `sliceLighting` and `declaredLight` — with the shipped `directIncidence` and
// `standardLighting` — run as JavaScript (`shaderRun`), once over the list of the pixel's cell,
// which the grid pass's oracle builds (`gridLists`, `gpuLightGridOracle.ts`), once over every light
// of the scene (`TILE_NO_SLICE`), in the four programs the resolve compiles: with and without
// shadow code, with and without rectangle code. A light left out of a cell reaches none of its
// points, so the full walk adds its exact zero there, and the two sums are the same numbers: random
// lamp sets of 1 to 256 lamps, a lamp touching one pixel, a cell every lamp reaches, the near plane
// and the far depth, an infinite range, a column no lamp meets. A NaN range never reaches the
// resolve: the contract refuses it.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  GRID,
  gridSlice,
  type TileView,
} from '../../../../../bench/oracles/browser/gpuLightGridOracle.ts'
import { gridLists } from '../../../../../bench/runner/lighting/lightGridWalk.ts'
import { validateSceneLight } from '../../../../sdk-core/src/scene/light/validate.ts'
import { random } from '../../page/cut/cutRuleChecks.fixture.ts'
import { shaderRun } from '../../texture/shaderRun.fixture.ts'
import { wgslConstants } from '../../texture/shaderRule.fixture.ts'
import { STANDARD_LIGHTING_WGSL } from '../standardLighting.ts'
import { NEAR, camera, pixelPoint, type Vec3 } from '../tiles/tileCamera.fixture.ts'
import { directLightingWgsl } from './lightingWgsl.ts'
import { lerp } from '../../../../math/src/scalar/reals.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'

type Lamp = { centre: Vec3; radius: number; spot: boolean }
type Sum = (...args: unknown[]) => number[]
const PROGRAMS = [false, true].flatMap((shadowed) =>
  [false, true].map((rects) =>
    wgslModule(
      directLightingWgsl({ unshadowed: !shadowed, rectless: !rects, lobeless: true }),
      STANDARD_LIGHTING_WGSL,
    ),
  ),
)
const NAMES = [
  'sliceLighting',
  'declaredLight',
  'directIncidence',
  'rangeWindow',
  'isSun',
  'isSunKind',
  'isRect',
]
const K = wgslConstants(PROGRAMS[0])

/** A lamp's record as the contract writes it: a point, or a spot looking down. */
const record = ({ centre, radius, spot }: Lamp, rank: number) => ({
  positionRange: [...centre, radius],
  colorIntensity: [1, 0.8 + (rank % 5) / 10, 0.6, 3 + (rank % 7)],
  directionCone: [0, -1, 0, spot ? 0.7 : -1],
  params: [spot ? K.KIND_SPOT : 0, -1, 0, spot ? 0.9 : 0],
  shape: [0, 0, 0, 0],
})

/** The four programs' sums at pixel (`px`, `py`) of depth `z`: over its cell's list, and over every lamp. */
function sums(view: TileView, lamps: Lamp[], px: number, py: number, z: number) {
  const { columns, columnsX } = gridLists(view, lamps)
  const listed =
    columns[Math.floor(py / GRID.cell) * columnsX + Math.floor(px / GRID.cell)].lists[gridSlice(z)]
  const P = pixelPoint(view, px, py, z)
  const N = [0.3, 0.9, 0.3].map((v) => v / Math.hypot(0.3, 0.9, 0.3)),
    V = [0.6, 0.8, 0]
  return PROGRAMS.map((program) => {
    const scope = {
      ...wgslConstants(program),
      directLights: { count: lamps.length, items: lamps.map(record) },
      tileLights: [7, 7, ...listed],
      thinSubsurface: [0, 0, 0],
      surfaceModel: 2,
      shadowReceiverOffset: [0, 0, 0],
      // No receiver plane: the read biases along the shading normal (`shadowBiasNormal`).
      shadowReceiverPlane: [0, 0, 0],
      shadowBiasNormal: (n: number[]) => n,
      shadowTransmission: [1, 1, 1],
      // A lamp with no shadow slot: the shipped read answers one (`shadowFactor`).
      shadowFactor: () => 1,
    }
    const names = [
      ...NAMES,
      'lobeSurface',
      'surfaceLight',
      'standardLobe',
      'fresnelSchlick',
      'ggxDistribution',
      'modelLight',
      'thinTransmission',
      // The maths library's, which the lobe and the lamp's diffuse call.
      'ndotvFloor',
      'f0Of',
      'lambertAlbedo',
      'lambertAlbedoMul',
    ]
    const { sliceLighting } = shaderRun<{ sliceLighting: Sum }>(program, names, scope)
    const at = (slice: number[]) => sliceLighting([0.8, 0.7, 0.6], 0.2, 0.5, N, V, P, 1, slice)
    return { cell: at([2, listed.length]), every: at([K.TILE_NO_SLICE, lamps.length]), listed }
  })
}

/** Asserts the cell's sum is every lamp's, bit for bit, in the four programs; returns the lamps listed. */
function same(view: TileView, lamps: Lamp[], px: number, py: number, z: number, where: string) {
  const all = sums(view, lamps, px, py, z)
  for (const { cell, every } of all)
    assert.ok(
      cell.every((v, i) => Object.is(v, every[i])),
      `${where}: ${cell} against ${every}`,
    )
  return all[0]
}

const view = camera([3, 6, -2], 0.8, -0.5, 70, 320, 200)

test('random lamp sets of 1 to 256: the cell list sums every lamp, bit for bit', () => {
  const r = random(1369),
    u = (lo: number, hi: number) => lerp(lo, hi, r())
  let reached = 0
  for (let count = 1; count <= 256; count++) {
    const [px, py] = [Math.floor(u(0, 320)), Math.floor(u(0, 200))]
    const z = Math.fround(NEAR / Math.exp(u(Math.log(0.12), Math.log(300))))
    const at = pixelPoint(view, px, py, z)
    const lamps = [...Array(count).keys()].map((rank): Lamp => {
      const radius = Math.fround(Math.exp(u(Math.log(0.05), Math.log(30))))
      const reach = u(0, 1.5) * radius
      const dir = [u(-1, 1), u(-1, 1), u(-1, 1)],
        len = Math.hypot(...dir) || 1
      const centre = at.map((v, a) => Math.fround(v + (dir[a] / len) * reach)) as Vec3
      return { centre, radius, spot: rank % 3 === 0 }
    })
    const { cell } = same(view, lamps, px, py, z, `${count} lamps`)
    reached += +cell.some((v) => v > 0)
  }
  assert.ok(reached > 200, `${reached} of 256 sets light their pixel`)
})

test('edge cases: one pixel touched, a cell every lamp reaches, near and far, an infinite range, an empty column', () => {
  const [px, py] = [319, 199]
  for (const z of [1, 0.5, 2 ** -12, NEAR / 1e5]) {
    const p = pixelPoint(view, px, py, z)
    const touching: Lamp = {
      centre: [p[0] + 0.3, p[1], p[2]],
      radius: Math.fround(0.30001),
      spot: false,
    }
    const every = [...Array(255).keys()].map((i): Lamp => ({
      centre: [p[0] + i / 9, p[1] - i / 7, p[2] + i / 5],
      radius: 1000 + i,
      spot: i % 2 === 0,
    }))
    const { cell, listed } = same(view, [touching, ...every], px, py, z, `depth ${z}`)
    assert.equal(listed.length, 256, 'every lamp listed')
    assert.ok(cell.some((v) => v > 0))
    const endless: Lamp = { centre: [p[0] + 50, p[1] + 20, p[2]], radius: Infinity, spot: false }
    assert.equal(same(view, [endless], px, py, z, `infinite range, depth ${z}`).listed.length, 1)
  }
  // A lamp in the far corner: the first column meets none, its list is empty and its sum zero.
  const far = pixelPoint(view, px, py, 2 ** -10)
  const empty = same(view, [{ centre: far, radius: 0.5, spot: false }], 5, 5, 0.5, 'empty column')
  assert.deepEqual([empty.listed.length, empty.cell], [0, [0, 0, 0]])
  const nan = {
    id: 'lamp',
    kind: 'point',
    position: [0, 0, 0],
    range: NaN,
    color: [1, 1, 1],
    intensity: 1,
  }
  assert.throws(() => validateSceneLight(nan as never), /range must be > 0/)
})
