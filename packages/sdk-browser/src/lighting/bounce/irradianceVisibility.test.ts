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
import { builtins } from '../../materials/texture/shaderRunBuiltins.fixture.ts'
import { spCommon } from './screen/commonWgsl.ts'
import { spHistory } from './screen/historyWgsl.ts'
import { spVectors } from './screen/vectorsWgsl.ts'
import { SCREEN_PROBE_FLAGS } from './screen/screenProbeLayout.ts'

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

/** The history of a 64 by 64 image run on the shipped text: `set` the depths the four texels round its centre kept, `reproject` the
 *  pixel at the centre over the point at the origin. */
function historyOf() {
  const identity = builtins.mat4x4f(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)
  const half = (depth: number) => (builtins.pack2x16float([depth, 0]) as number) & 0xffff
  const depths = new Map<string, number>()
  const texels = [
    [31, 31],
    [32, 31],
    [31, 32],
    [32, 32],
  ]
  const { spReproject } = shaderRun<{
    spReproject: (
      pixel: number[],
      P: number[],
      N: number[],
      noise: number,
    ) => { texel: number[]; weights: number[]; words: number[][]; w: number }
  }>(wgslModule(spCommon([4, 2]), spHistory(7, 8)), ['spReproject'], {
    sp: {
      size: [64, 64, 16, 0],
      counts: [10, 0, 0, 0],
      mode: [0, 0, SCREEN_PROBE_FLAGS.temporal, 0],
      scene: [0, 0, 0, 0.01],
      motion: [0.005, 10, 0.9, 0],
    },
    reflectionView: { radianceViewProj: identity, radiance: [64, 64, 0, 0], slab: [1, 0, 0, 1] },
    historyIn: {},
    viewToEye: () => [0, 0, 1],
    textureLoad: (_: unknown, texel: number[]) => [0, half(depths.get(String(texel)) ?? 0), 0, 0],
  })
  return {
    set: (values: number[]) => texels.forEach((t, i) => depths.set(String(t), values[i])),
    reproject: (N: number[], noise: number) => spReproject([32, 32], [0, 0, 0], N, noise),
  }
}

test("a history texel counts where its depth is the expected one within a threshold the noise and the surface's slope move", () => {
  const { set, reproject } = historyOf()
  const weights = (N: number[], noise: number) => reproject(N, noise).weights
  set([1, 1, 1.08, 1])
  assert.deepEqual(
    weights([0, 0, 1], 0.5),
    [0.25, 0.25, 0, 0.25],
    'a tap on another surface is nothing',
  )
  assert.deepEqual(
    weights([1, 0, 0], 0.5),
    [0.25, 0.25, 0.25, 0.25],
    'a grazing surface lets its threshold grow tenfold',
  )
  set([1, 1.008, 1, 1])
  assert.equal(weights([0, 0, 1], 0)[1], 0, 'the noise narrows the threshold to a half')
  assert.equal(weights([0, 0, 1], 1)[1], 0.25, 'and widens it by a half')
  const kept = reproject([0, 0, 1], 0.5)
  assert.equal(kept.w, 1, 'the depth expected: the linear depth, the clip w of a perspective')
  assert.deepEqual(
    kept.words[0].length,
    2,
    "the words of a texel come with its weight: the light's and the meta",
  )
})

test('a surface the camera alone moves keeps its exact reprojection, one that moves by itself the one its vector names', () => {
  const identity = builtins.mat4x4f(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)
  let vector = [0, 0]
  const { encodeVector, spMotionOf } = shaderRun<{
    encodeVector: (v: number[]) => number
    spMotionOf: (pixel: number[], P: number[], camera: number[]) => { ndc: number[]; speed: number }
  }>(wgslModule(spCommon([4, 2]), spVectors(9)), ['encodeVector', 'spMotionOf'], {
    sp: {
      size: [64, 64, 16, 0],
      mode: [0, 0, SCREEN_PROBE_FLAGS.velocity, 0],
      motion: [0.005, 10, 0.9, 0],
      previous: identity,
    },
    reflectionView: { radianceViewProj: identity, viewProj: identity, slab: [1, 0, 0, 1] },
    view: { camera: [0, 0, 10, 1] },
    sceneVectors: {},
    textureLoad: () => [encodeVector(vector), 0, 0, 0],
  })
  // The pixel (32, 32) shows the point whose device position the identity view-projection gives.
  const pixel = [32, 32],
    here = 32.5 / 32 - 1,
    P = [here, -here, 0.5],
    camera = [here, -here]
  const near = (a: number[], b: number[], within: number) =>
    a.every((v, i) => Math.abs(v - b[i]) <= within)
  vector = [0, 0]
  const still = spMotionOf(pixel, P, camera)
  assert.ok(still.speed < 2e-4, `the camera alone: no velocity, ${still.speed}`)
  assert.deepEqual(still.ndc, camera, 'and its camera reprojection')
  vector = [0.1, 0]
  const moved = spMotionOf(pixel, P, camera)
  assert.ok(Math.abs(moved.speed - 0.1) < 2e-3, `a surface that moved: ${moved.speed}`)
  assert.ok(near(moved.ndc, [here - 0.1, -here], 2e-3), 'its vector')
})
