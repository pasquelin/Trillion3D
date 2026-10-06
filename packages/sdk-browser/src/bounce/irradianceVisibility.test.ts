// The surface cache's direct term traced a shadow ray for the first four shadow-casting
// lights only; from the fifth on, a light behind a wall lit the cell through it, and the bounce
// carried that light into the room. The shipped `directIrradiance` runs here against a flat wall.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun, type Vec } from '../texture/shaderRun.fixture.ts'
import { SURFACE_IRRADIANCE_WGSL } from './irradianceWgsl.ts'

type Light = { height: number; energy: number; casts?: boolean }
type Items = { params: Vec; positionRange: Vec; colorIntensity: Vec }[]

/** The cell at the origin, facing up, lit by point lights straight above it at `height`; a wall
 *  fills the plane y = `wall`. Falloff and incidence are 1, so the result is the sum of the
 *  energies that reach the cell. `rays` counts the shadow rays traced. */
const scene = { wall: 0, rays: 0 }
const directLights = { count: 0, items: [] as Items }
const { directIrradiance } = shaderRun<{
  directIrradiance: (P: Vec, N: Vec, reach: number) => Vec
}>(SURFACE_IRRADIANCE_WGSL, ['directIrradiance'], {
  directLights,
  isRect: () => false,
  isSun: () => false,
  rectIrradiance: () => [0, 0, 0, 0],
  directIncidence: () => [0, 1, 0, 1],
  proxyBlocked: (origin: Vec, direction: Vec, span: number) => {
    scene.rays++
    const hit = (scene.wall - Number(origin[1])) / Number(direction[1])
    return hit > 0 && hit < span
  },
})

function irradiance(lights: Light[], wall: number) {
  directLights.items = lights.map(({ height, energy, casts = true }) => ({
    params: [0, 0, casts ? 1 : 0, 0],
    positionRange: [0, height, 0, 100],
    colorIntensity: [energy, energy, energy, 1],
  }))
  directLights.count = lights.length
  Object.assign(scene, { wall, rays: 0 })
  return directIrradiance([0, 0, 0], [0, 1, 0], 100)[0]
}

const SIX = [2, 3, 4, 5, 6, 7].map((height, i) => ({ height, energy: 2 ** i }))

test('no shadow-casting light shines through a wall, however many lights come before it', () => {
  assert.equal(irradiance(SIX, 1), 0, 'a wall below all six lights holds all six')
  assert.equal(irradiance([...SIX].reverse(), 1), 0, 'in either order')
  assert.equal(irradiance(SIX, 5.5), 1 + 2 + 4 + 8, 'the four lights before the wall, only')
  assert.equal(irradiance([...SIX].reverse(), 5.5), 1 + 2 + 4 + 8, 'whatever their order')
  assert.equal(irradiance(SIX, 10), 63, 'with no wall between, every light reaches the cell')
})

test('a light that casts no shadow still lights the cell through the wall, as it always did', () => {
  const lights = [...SIX, { height: 9, energy: 64, casts: false }]
  assert.equal(irradiance(lights, 1), 64)
})

test('a light that adds nothing at the cell traces no shadow ray', () => {
  assert.equal(irradiance([...SIX, { height: 3, energy: 0 }], 10), 63)
  assert.equal(scene.rays, SIX.length)
})
