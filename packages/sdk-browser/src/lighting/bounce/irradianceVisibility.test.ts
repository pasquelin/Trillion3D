// A bounce point's direct term once traced a shadow ray for the first four shadow-casting
// lights only; from the fifth on, a light behind a wall lit the cell through it, and the bounce
// carried that light into the room. The engine's one light loop, in its irradiance term
// (`lightsIrradiance`, `../direct/lightLoopWgsl.ts`) and its reach test (`lightReaches`),
// runs here against a flat wall.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import type { Vec } from '../../materials/texture/shaderRunBuiltins.fixture.ts'
import { LIGHTS_IRRADIANCE_WGSL } from '../direct/lightLoopWgsl.ts'
import { DIRECT_LIGHT_WGSL } from '../direct/lightWgsl.ts'
import { nearRelative } from '../../../../math/src/float/near.fixture.ts'
import { LIGHT_SETTINGS } from '../../../../sdk-core/src/scene/light/contracts.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { TILE_NO_SLICE } from '../tiles/noSlice.ts'

const BIAS = LIGHT_SETTINGS.lampDistanceBias

/** The incidence's strength at `P` of a light whose irradiance, in the bounce's inverse square, is one. */
function unitIncidence({ positionRange }: { positionRange: Vec }, P: Vec) {
  const d2 = [0, 1, 2].reduce((sum, k) => sum + (Number(positionRange[k]) - Number(P[k])) ** 2, 0)
  return Math.max(d2, BIAS) / (d2 + BIAS)
}

/** The irradiance is `expected` to float rounding. */
const near = (actual: number, expected: number, label = 'the irradiance') =>
  nearRelative(actual, expected, label, 1e-5)

type Light = { height: number; energy: number; casts?: boolean; range?: number }
type Items = {
  params: Vec
  positionRange: Vec
  colorIntensity: Vec
  shape: Vec
  capsule: Vec
}[]

/** The engine's light loop over point lights — rectangle ones when `rect`, each of irradiance one —
 *  straight above the cell at the origin, facing up, at `height`; a wall fills the plane y = `wall`.
 *  Falloff and incidence are 1, so the result is the sum of the energies that reach the cell.
 *  `rays` counts the shadow rays the last reading traced. The incidence the stub hands the loop is the one that makes
 *  the loop's product one: the bounce takes a lamp's inverse square at the distance itself, held at a square
 *  centimetre (`lampDistanceBias`), where the incidence has it a square centimetre longer. */
function lightLoop(rect: boolean) {
  const scene = { wall: 0, rays: 0 }
  const directLights = { count: 0, items: [] as Items }
  const { lightsIrradiance } = shaderRun<{
    lightsIrradiance: (P: Vec, N: Vec, reach: number) => Vec
  }>(
    wgslModule(DIRECT_LIGHT_WGSL, LIGHTS_IRRADIANCE_WGSL),
    ['lightsIrradiance', 'declaredIrradiance'],
    {
      directLights,
      isRect: () => rect,
      isSun: () => false,
      isSunKind: () => false,
      // No world lists: every light, the loop's fallback (`bounceLightSlice`).
      TILE_NO_SLICE,
      bounceLightSlice: () => [0xffffffff, directLights.count],
      listedLight: (_slice: number[], index: number) => index,
      tileLights: [],
      rectIrradiance: () => [0, 0, 0, 1],
      directIncidence: (light: { positionRange: Vec }, P: Vec) => [
        0,
        1,
        0,
        unitIncidence(light, P),
      ],
      rtBlocked: (origin: Vec, direction: Vec, span: number) => {
        scene.rays++
        const hit = (scene.wall - Number(origin[1])) / Number(direction[1])
        return hit > 0 && hit < span
      },
    },
  )
  const irradiance = (lights: Light[], wall: number) => {
    directLights.items = lights.map(({ height, energy, casts = true, range = 100 }) => ({
      params: [0, 0, casts ? 1 : 0, 0],
      positionRange: [0, height, 0, range],
      colorIntensity: [energy, energy, energy, 1],
      shape: [0, 0, 0, 0],
      capsule: [0, 0, 0, 0],
    }))
    directLights.count = lights.length
    Object.assign(scene, { wall, rays: 0 })
    return lightsIrradiance([0, 0, 0], [0, 1, 0], 100)[0]
  }
  return { scene, irradiance }
}

const { scene, irradiance } = lightLoop(false)

const SIX = [2, 3, 4, 5, 6, 7].map((height, i) => ({ height, energy: 2 ** i }))

test('no shadow-casting light shines through a wall, however many lights come before it', () => {
  near(irradiance(SIX, 1), 0, 'a wall below all six lights holds all six')
  near(irradiance([...SIX].reverse(), 1), 0, 'in either order')
  near(irradiance(SIX, 5.5), 1 + 2 + 4 + 8, 'the four lights before the wall, only')
  near(irradiance([...SIX].reverse(), 5.5), 1 + 2 + 4 + 8, 'whatever their order')
  near(irradiance(SIX, 10), 63, 'with no wall between, every light reaches the cell')
})

test('a light that casts no shadow still lights the cell through the wall, as it always did', () => {
  const lights = [...SIX, { height: 9, energy: 64, casts: false }]
  near(irradiance(lights, 1), 64)
})

test('a light that adds nothing at the cell traces no shadow ray', () => {
  near(irradiance([...SIX, { height: 3, energy: 0 }], 10), 63)
  assert.equal(scene.rays, SIX.length)
})

test('a light past its range is rejected on its sphere: no ray, no light', () => {
  near(irradiance([...SIX, { height: 9, energy: 64, range: 8 }], 10), 63)
  assert.equal(scene.rays, SIX.length, 'the out-of-range light traces nothing')
})

test('a rectangle light behind a wall lights no cell through it: one ray toward its centre', () => {
  const rect = lightLoop(true)
  const at = (height: number, casts: boolean) => rect.irradiance([{ height, energy: 2, casts }], 1)
  assert.equal(at(3, true), 0, 'the wall at y = 1 holds the rectangle above it')
  assert.equal(rect.scene.rays, 1)
  assert.equal(at(0.5, true), 2, 'below the wall, it lights the cell')
  assert.equal(rect.scene.rays, 1)
  assert.equal(at(3, false), 2, 'a rectangle that casts no shadow lights it through the wall')
  assert.equal(rect.scene.rays, 0, 'and traces no ray')
})

test('a lamp’s shadow ray stops short of the lamp: a surface the lamp stands against does not shade the cell', () => {
  // The ray starts 2 cm along the light and walks the lamp's distance from the cell: it used to end 2 cm past
  // the lamp, in a wall 1 cm behind it.
  const lamp = [{ height: 3, energy: 1 }]
  near(irradiance(lamp, 3.01), 1, 'a wall 1 cm behind the lamp')
  near(irradiance(lamp, 2.9), 0, 'a wall between the cell and the lamp still shades it')
  // A cell nearer the lamp than the bias starts its ray halfway to it, not past it.
  near(irradiance([{ height: 0.01, energy: 1 }], 0.025), 1, 'a cell 1 cm under the lamp')
})
