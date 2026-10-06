// #1369: the light grid's lists are conservative — every light whose range holds a pixel's point is
// in the list of the cell that pixel's depth falls in —, so the resolve's sum over the list is the sum
// over every light, the zeros of the others left out: the image of develop. Checked in f64 against
// the pass's oracle (`gpuLightGridOracle.ts`, a port of `boundsWgsl.ts`) on random views — from the
// street to straight down from 2 km, up to 150 km from the world origin — and random lights near
// random pixels, with the edge cases: a lamp touching one pixel, a cell every lamp reaches, the near
// plane and the far distance, infinite and NaN ranges.
import test from 'node:test'
import assert from 'node:assert/strict'
import { LIGHT_SETTINGS } from '../../../../sdk-core/src/index.ts'
import {
  GRID,
  cellColumn,
  gridSlice,
  sphereInColumn,
  toTileFrame,
  type TileView,
} from '../../../../../bench/oracles/browser/gpuLightGridOracle.ts'
import {
  NEWTON_STEPS,
  RUN_MARGIN,
  columnFrame,
  lightRun,
} from '../../../../../bench/oracles/browser/gpuLightGridRunOracle.ts'
import { random } from '../../page/cut/cutRuleChecks.fixture.ts'
import { NEAR, camera, pixelPoint, type Vec3 } from './tileCamera.fixture.ts'
import { GRID_BOUNDS_WGSL } from './boundsWgsl.ts'
import { directLightingWgsl } from '../direct/lightingWgsl.ts'
import { shaderFunctions, wgslConstants } from '../../texture/shaderRule.fixture.ts'

const DIRECT_LIGHTING_WGSL = directLightingWgsl()

type Light = { centre: Vec3; radius: number }
const CELL = LIGHT_SETTINGS.tileSize

/** Whether the cell of pixel (`px`, `py`) at depth `z` lists `light`, as the pass decides. */
function listed(view: TileView, px: number, py: number, z: number, { centre, radius }: Light) {
  const cell: [number, number] = [Math.floor(px / CELL), Math.floor(py / CELL)]
  const planes = cellColumn(view, cell)
  const at = toTileFrame(view, centre)
  if (!sphereInColumn(planes, at, radius)) return false
  const run = lightRun(view, columnFrame(view, cell, planes), at, radius)
  const slice = gridSlice(z)
  return !!run && run[0] <= slice && slice <= run[1]
}

/** Every light reaching the point of pixel (`px`, `py`) at depth `z` is listed there. */
function checkPixel(view: TileView, px: number, py: number, z: number, lights: Light[]) {
  const p = pixelPoint(view, px, py, z)
  for (const light of lights) {
    const d = Math.hypot(...p.map((v, a) => v - light.centre[a]))
    if (!(d < light.radius)) continue
    const where = `light ${light.centre} r ${light.radius}, pixel ${px},${py} z ${z}`
    assert.ok(listed(view, px, py, z, light), `a pixel it reaches loses it: ${where}`)
  }
}

test("random views: every light that reaches a pixel is in its cell's list", () => {
  for (let seed = 1; seed <= 400; seed++) {
    const r = random(seed),
      u = (lo: number, hi: number) => lo + (hi - lo) * r()
    const [width, height] = [Math.round(u(320, 3456)), Math.round(u(240, 2234))]
    const far = seed % 4 === 0 ? 150_000 : 5000
    const eye: Vec3 = [u(-far, far), u(1.7, 2000), u(-far, far)]
    const pitch = seed % 3 === 0 ? -Math.PI / 2 : u(-Math.PI / 2, Math.PI / 6)
    const view = camera(eye, u(-Math.PI, Math.PI), pitch, u(30, 100), width, height)
    for (let pixel = 0; pixel < 8; pixel++) {
      const [px, py] = [Math.floor(u(0, width)), Math.floor(u(0, height))]
      const z = Math.fround(NEAR / Math.exp(u(Math.log(0.12), Math.log(3000))))
      const at = pixelPoint(view, px, py, z)
      const lights = [...Array(12).keys()].map(() => {
        const radius = Math.exp(u(Math.log(0.01), Math.log(200)))
        const dir = [u(-1, 1), u(-1, 1), u(-1, 1)],
          len = Math.hypot(...dir) || 1
        const reach = u(0, 1.2) * radius
        const centre = at.map((v, a) => Math.fround(v + (dir[a] / len) * reach)) as Vec3
        return { centre, radius: Math.fround(radius) }
      })
      checkPixel(view, px, py, z, lights)
    }
  }
})

test('edge cases: a lamp touching one pixel, a cell every lamp reaches, near and far', () => {
  const view = camera([12, 40, -7], 1, -0.7, 70, 1270, 710)
  const [px, py] = [1269, 709] // the last, cut cell on both axes
  for (const z of [1, 0.5, 2 ** -12, NEAR / 1e5]) {
    const p = pixelPoint(view, px, py, z)
    // A lamp just past the point: its range holds it by a hair.
    const touching = { centre: [p[0] + 0.3, p[1], p[2]] as Vec3, radius: Math.fround(0.30001) }
    const all = [...Array(64).keys()].map((i) => ({
      centre: [p[0] + i, p[1] - i, p[2] + 2 * i] as Vec3,
      radius: 1000 + i,
    }))
    checkPixel(view, px, py, z, [touching, ...all])
    assert.ok(
      all.every((light) => listed(view, px, py, z, light)),
      'every lamp listed',
    )
  }
  const p = pixelPoint(view, 5, 5, 0.5)
  const at = (radius: number) => listed(view, 5, 5, 0.5, { centre: p, radius })
  assert.deepEqual([at(Infinity), at(NaN), at(0)], [true, false, false])
})

test("the pass runs the oracle's constants and the resolve its slice", () => {
  const W = wgslConstants(GRID_BOUNDS_WGSL)
  assert.equal(W.NEWTON_STEPS, NEWTON_STEPS)
  assert.deepEqual([W.RUN_FRONT, W.RUN_BACK].map(Math.fround), RUN_MARGIN)
  assert.ok(GRID_BOUNDS_WGSL.includes('let r=radius*1.001;'))
  const { gridSlice: shipped } = shaderFunctions<{ gridSlice: (z: number) => number }>(
    DIRECT_LIGHTING_WGSL,
    ['gridSlice'],
    {
      ...wgslConstants(DIRECT_LIGHTING_WGSL),
      log2: Math.log2,
      clamp: (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi),
    },
  )
  for (const z of [1, 0.999, 0.5, 0.1, 1e-3, 1e-6, 0])
    assert.equal(shipped(z), gridSlice(z), `depth ${z}`)
  assert.equal(gridSlice(0), GRID.slices - 1, 'the background, the last slice')
})
