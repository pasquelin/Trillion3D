// #924: light iterations are counted per COVERED pixel — a sky pixel walks no list —, and the cost
// model multiplies them by the covered pixels, never by every pixel of the image.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  NEAR,
  camera,
} from '../../../packages/sdk-browser/src/lighting/tiles/tileCamera.fixture.ts'
import { blockIndex, depthField, emptyBlocks, type City, type Light } from './lightTileCity.ts'
import { countGrid } from './lightGridCount.ts'
import { COST_MODEL, modelMs } from './lightTileIterations.ts'

// Straight down from 100 m onto one 30 m building (x and z 8 to 52 m), the ground all around.
const view = camera([30, 100, 30], 0, -Math.PI / 2, 60, 64, 48)
const city = (lights: Light[]): City => {
  const blocks = emptyBlocks()
  blocks[blockIndex(0, 0)] = 30
  return { blocks, lights }
}

test('the city is ray-cast as the depth buffer holds it', () => {
  const depths = depthField(city([]), view)
  const at = (x: number, y: number) => depths[y * view.width + x]
  assert.ok(Math.abs(at(32, 24) * 70 - NEAR) < 1e-6, 'the roof, 70 m away')
  assert.ok(Math.abs(at(0, 0) * 100 - NEAR) < 1e-6, 'the ground, 100 m away')
})

test('iterations are summed over covered pixels', () => {
  const everywhere: Light = { centre: [30, 0, 30], radius: 1000 }
  const farAway: Light = { centre: [5000, 0, 5000], radius: 1 }
  const depths = depthField(city([]), view)
  // The left half sees the sky: those pixels walk no list and are not covered.
  for (let y = 0; y < view.height; y++) depths.fill(0, y * view.width, y * view.width + 32)
  const result = countGrid(view, depths, [everywhere, farAway])
  assert.equal(result.covered, (view.width * view.height) / 2)
  // Every covered pixel walks the light that holds the whole view, and only it.
  assert.deepEqual(
    [result.listed, result.reach, result.missed],
    [result.covered, result.covered, 0],
  )
})

test('the cost model prices the covered pixels only', () => {
  const gpu = COST_MODEL.classes.B
  const full = (gpu.pixels * 3.71 * 20) / (gpu.lanes * gpu.ghz * 1e9 * 0.5)
  assert.ok(Math.abs(modelMs(gpu, 1, 3.71) - full * 1e3) < 1e-12)
  assert.ok(Math.abs(modelMs(gpu, 0.544, 3.71) - 0.544 * full * 1e3) < 1e-12)
})
