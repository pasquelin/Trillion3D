import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../texture/shaderRun.fixture.ts'
import { BLEND_TRANSMITTANCE_WGSL } from './transmittanceWgsl.ts'
import { FLAG_HAS_MAP, FLAG_HAS_UV } from '../../visibility/types.ts'

const world = (x = 1, y = 1, z = 1) => [
  [x, 0, 0, 0],
  [0, y, 0, 0],
  [0, 0, z, 0],
  [0, 0, 0, 1],
]
const page = () => ({
  world: world(),
  transmission: 1,
  thickness: 2,
  blendCoverage: 1,
  flags: 0,
  mapIndex: 0,
  baseColor: [1, 1, 1, 1],
  attenuationRG: [0.5, 0.25],
  attenuationB: 1,
  attenuationDistance: 2,
})
type Page = ReturnType<typeof page>
const { volumeBoundary, volumeWorldThickness, blendTransmittance } = shaderRun<{
  volumeBoundary: (page: Page, front: boolean) => boolean
  volumeWorldThickness: (page: Page, ray: number[]) => number
  blendTransmittance: (
    page: Page,
    uv: number[],
    dx: number[],
    dy: number[],
    ray: number[],
  ) => number[]
}>(
  BLEND_TRANSMITTANCE_WGSL,
  ['volumeBoundary', 'volumeWorldThickness', 'blendTransmittance', 'volumeTransmittanceOf'],
  {
    cross: (a: number[], b: number[]) => [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ],
    mix: (a: number[], b: number[], t: number) => a.map((v, i) => v * (1 - t) + b[i] * t),
    maskAlpha: () => 0.5,
    colorSample: () => [0.25, 0.5, 1, 0.5],
  },
)
const through = (p: Page) => blendTransmittance(p, [0, 0], [1, 0], [0, 1], [0, 0, 1])

test('a closed volume absorbs once; two volumes multiply, while thin sheets retain both boundaries', () => {
  const p = page()
  assert.equal(volumeBoundary(p, true), true)
  assert.equal(volumeBoundary(p, false), false)
  assert.deepEqual(through(p).slice(0, 3), [0.5, 0.25, 1])
  assert.deepEqual(
    through(p)
      .slice(0, 3)
      .map((v) => v * v),
    [0.25, 0.0625, 1],
  )
  p.world = world(-1, 1, 1)
  assert.equal(volumeBoundary(p, true), false)
  assert.equal(volumeBoundary(p, false), true)
  p.thickness = 0
  assert.equal(volumeBoundary(p, true), true)
  assert.equal(volumeBoundary(p, false), true)
  assert.deepEqual(through(p), [1, 1, 1, 0])
})

test('declared local path scales along the light ray, including shear and singular transforms', () => {
  const p = page()
  p.world = world(2, 3, 4)
  assert.equal(volumeWorldThickness(p, [1, 0, 0]), 4)
  assert.equal(volumeWorldThickness(p, [0, 10, 0]), 6)
  assert.equal(volumeWorldThickness(p, [0, 0, 1]), 8)
  p.world = world()
  p.world[1][0] = 1
  assert.ok(Math.abs(volumeWorldThickness(p, [1, 1, 0]) - 2 * Math.sqrt(2)) < 1e-12)
  p.world = world(1, 0, 1)
  assert.equal(volumeWorldThickness(p, [0, 1, 0]), 0)
  assert.equal(volumeWorldThickness(p, [0, 0, 0]), 0)
})

test('the color atlas tints transmission independently of coverage, retaining alpha shadow behavior', () => {
  const p = page()
  p.flags = FLAG_HAS_MAP | FLAG_HAS_UV
  assert.deepEqual(through(p), [0.5625, 0.5625, 1, 0.5])
  p.transmission = 0
  assert.deepEqual(through(p), [0.5, 0.5, 0.5, 0.5])
  assert.equal(volumeBoundary(p, false), true)
  p.blendCoverage = 0
  assert.deepEqual(through(p), [1, 1, 1, 1])
})
