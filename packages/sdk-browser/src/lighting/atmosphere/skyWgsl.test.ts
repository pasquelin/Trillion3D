// The sky pass as shipped, run in JavaScript (`shaderRun`): its disk of the sun is multiplied by the
// image's pre-exposure once and held to what an exposed disk may hold, not twice; the table is read
// by an eye inside the air, and the sky is marched for an eye above it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { Mat } from '../../materials/texture/shaderRunMatrix.fixture.ts'
import { skyFaceProgram } from '../../modules/sky/skyLight/faceWgsl.ts'
import { capture360Program } from './capture360Wgsl.ts'
import { GROUND_SKY_RADIANCE, groundSkyMarch } from './captureWgsl.ts'
import { airProgram } from './programs.ts'
import { SKY_MAX_RADIANCE } from './layout.ts'
import { DEFAULT_AIR_SHAPE } from './shape.ts'
import { skyProgram } from './skyWgsl.ts'

/** The direction of the pixel the run reads (the clip point (-1, 1, 0.5) of an identity camera at the origin). */
const TOWARD = (() => {
  const length = Math.hypot(-1, 1, 0.5)
  return [-1 / length, 1 / length, 0.5 / length]
})()

/** The radius of the top of the air the runs stand under, kilometres. */
const TOP_RADIUS = 6420

/** The sky pass's fragment and disk functions over a sun of `luminance` in every channel and a sky
 *  table that answers `scattered`, an image pre-exposed by `preExposure`, the eye `height`
 *  kilometres from the planet's centre; the march of a ray, where it is asked, answers `marched`;
 *  `hidden` says the air is not drawn in the view. The sky holds no fog: the fog pass lays it over. */
function skyRun(
  preExposure: number,
  luminance: number,
  scattered: number,
  height = 0.001,
  marched = 0,
  hidden = 0,
  holdout = 0,
  transmittance = 1,
) {
  const identity = new Mat([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
  return shaderRun<{
    skyMain: (pixel: number[]) => number[]
    lightDisks: (p: number[], dir: number[]) => number[]
  }>(skyProgram(DEFAULT_AIR_SHAPE).code, ['skyMain', 'lightDisks'], {
    frame: {
      eye: [0, 0, 0, 1],
      camera: [0, 0, 6360.001, height],
      inverseViewProj: identity,
      size: [1, 1, 1, 1],
      preExposure: [preExposure, 0, 0, 0],
      index: [0, 0, 0, 0],
      hidden: [hidden, holdout, 0, 0],
    },
    flags: { load: () => [0, 0, 0, 0] },
    skyViewTable: {},
    tableSampler: {},
    airSuns: () => ({
      count: 1,
      list: [
        {
          toward: TOWARD,
          cosRadius: Math.cos(0.00467),
          disk: [luminance, luminance, luminance, 1],
        },
      ],
    }),
    transmittanceToward: () => [1, 1, 1],
    // The table answers one colour; the planet is never hit; the fog lets everything through.
    eyeToTable: (dir: number[]) => dir,
    skyViewUv: () => [0, 0],
    textureSampleLevel: () => [scattered, scattered, scattered, transmittance],
    raySphereNearest: () => -1,
    bottomRadius: () => 6360,
    topRadius: () => TOP_RADIUS,
    marchedSky: () => [marched, marched, marched, transmittance],
    blueNoiseScalar: () => 0.5,
    atmo: () => [1, 1, 1, 1],
  })
}

test('an atmosphere that holds its light out draws black, its alpha the coverage of its air', () => {
  const { skyMain } = skyRun(2, 5, 0.3, 0.001, 0, 0, 1, 0.25)
  assert.deepEqual(skyMain([0.5, 0.5, 0, 0]), [0, 0, 0, 0.75], 'the table’s')
  const above = skyRun(2, 5, 0, TOP_RADIUS - 6360 + 100, 0.3, 0, 1, 0.5).skyMain
  assert.deepEqual(above([0.5, 0.5, 0, 0]), [0, 0, 0, 0.5], 'the march’s')
  assert.notDeepEqual(skyRun(2, 5, 0.3).skyMain([0.5, 0.5, 0, 0]).slice(0, 3), [0, 0, 0])
})

test('the sun disk scales as the pre-exposure, not as its square', () => {
  const at = (preExposure: number) => skyRun(preExposure, 5000, 0).skyMain([0, 0, 0, 0])[0]
  assert.equal(at(1), 5000)
  assert.equal(at(2), 10000)
  assert.equal(at(4), 20000)
})

test('the sky is exposed once and the disk once, and the two add', () => {
  assert.equal(skyRun(2, 5000, 100).skyMain([0, 0, 0, 0])[0], 2 * 5000 + 2 * 100)
})

test('where the air is not drawn in the view the sky is black, the disk gone; the sky holds no fog, the fog pass lays it over', () => {
  assert.deepEqual(skyRun(2, 5000, 100, 0.001, 0, 1).skyMain([0, 0, 0, 0]), [0, 0, 0, 1])
  const code = skyProgram(DEFAULT_AIR_SHAPE).code
  assert.ok(!code.includes('fogBeyondAt') && !code.includes('fogOver'))
})

test('seen from above the air, a disk is seen through the chord of the air from where its ray enters, and through none where it never does', () => {
  const run = (entry: number[], kept: number) =>
    shaderRun<{ lightDisks: (p: number[], dir: number[]) => number[] }>(
      skyProgram(DEFAULT_AIR_SHAPE).code,
      ['lightDisks'],
      {
        frame: { preExposure: [1, 0, 0, 0] },
        airSuns: () => ({
          count: 1,
          list: [{ toward: TOWARD, cosRadius: Math.cos(0.00467), disk: [1000, 1000, 1000, 1] }],
        }),
        moveToTopAtmosphere: () => entry,
        transmittanceToward: (at: number[]) =>
          at[1] === 6419.999 ? [kept, kept, kept] : [0, 0, 0],
      },
    ).lightDisks([0, 8000, 0], TOWARD)
  assert.deepEqual(run([0, 0, 0, 0], 0.5), [1000, 1000, 1000], 'never enters: nothing in the way')
  assert.deepEqual(run([0, 6419.999, 0, 1], 0.5), [500, 500, 500], 'the air read at the entry')
})

test('an exposed disk is held to 64000 per channel, the cap applied after the exposure', () => {
  const disks = skyRun(2, 1e9, 0).lightDisks([0, 0, 6360.001], TOWARD)
  assert.deepEqual(disks, [64000, 64000, 64000])
})

test('an eye inside the air reads the sky table, up to a hair over its top', () => {
  assert.equal(skyRun(1, 0, 5, TOP_RADIUS - 1, 3).skyMain([0, 0, 0, 0])[0], 5)
  assert.equal(skyRun(1, 0, 5, TOP_RADIUS + 0.005, 3).skyMain([0, 0, 0, 0])[0], 5)
})

test('an eye above the air marches the sky, the table does not describe that view', () => {
  assert.equal(skyRun(1, 0, 5, TOP_RADIUS + 1, 3).skyMain([0, 0, 0, 0])[0], 3)
  assert.equal(skyRun(1, 0, 5, TOP_RADIUS + 500, 3).skyMain([0, 0, 0, 0])[0], 3)
})

test('the march is reachable under the default (table) shape: its resources are bound', () => {
  const { bindings } = skyProgram(DEFAULT_AIR_SHAPE)
  assert.ok(DEFAULT_AIR_SHAPE.skyView.fast)
  assert.ok(bindings.noise && bindings.multiScatter && bindings.cloudShadow)
})

/** Where the march of a sky ray (`groundSkyMarch`, the capture's) starts,
 *  for a place `altitudeKm` over the planet's surface and a ray along `dir`: the start `integrateAir` is given. */
function marchStart(altitudeKm: number, dir: number[]) {
  const starts: number[][] = []
  const place = `vec3f(0.0,bottomRadius()+${altitudeKm},0.0)`
  const { skyAlong } = shaderRun<{ skyAlong: (dir: number[]) => number[] }>(
    airProgram(
      { air: 'read', transmittance: true, multiScatter: true },
      `fn skyAlong(dir:vec3f)->vec3f{${groundSkyMarch(place)}
 return ${GROUND_SKY_RADIANCE};
}`,
    ).code,
    ['skyAlong'],
    {
      bottomRadius: () => 6360,
      topRadius: () => TOP_RADIUS,
      airSuns: () => ({ count: 1, list: [] }),
      samplesMaxOf: () => 32,
      atmo: () => [1, 1, 1, 1],
      integrateAir: (start: number[]) => (starts.push(start), { radiance: [1, 1, 1] }),
    },
  )
  skyAlong(dir)
  return starts[0]
}

test('a sky ray from above the air is marched from where it enters the air, not from the place', () => {
  // Straight down from 100 km: it enters at the top, a metre in.
  const down = marchStart(100, [0, -1, 0])
  assert.ok(Math.abs(Math.hypot(...down) - (TOP_RADIUS - 0.001)) < 1e-3)
  // A ray that misses the air starts where it is asked from; the march then has nothing to cross.
  assert.deepEqual(marchStart(100, [0, 1, 0]), [0, 6460, 0])
  // Inside the air the place is the start, as before.
  assert.deepEqual(marchStart(10, [0, 1, 0]), [0, 6370, 0])
})

test('the place of a capture is held over the ground, not under the top of the air', () => {
  const placeAt = (y: number) =>
    shaderRun<{ sceneToPlanet: (scene: number[]) => number[] }>(
      capture360Program(DEFAULT_AIR_SHAPE).code,
      ['sceneToPlanet'],
      { atmo: () => [0, 0, 0, 0], bottomRadius: () => 6360, topRadius: () => TOP_RADIUS },
    ).sceneToPlanet([0, y, 0])
  assert.ok(Math.abs(placeAt(100_000)[1] - 6460) < 1e-3)
  assert.ok(Math.abs(placeAt(-500)[1] - 6360.005) < 1e-3)
})

test('the sky the sky light captures is held to what the view’s sky is held to, no more', () => {
  const skyFaceAt = (preExposure: number, height = TOP_RADIUS * 2) =>
    shaderRun<{ skyFaceMain: (pixel: number[]) => number[] }>(
      skyFaceProgram(DEFAULT_AIR_SHAPE).code,
      ['skyFaceMain'],
      {
        pixelDirection: () => [0, 1, 0],
        cubeToScene: (dir: number[]) => dir,
        bottomRadius: () => 6360,
        topRadius: () => TOP_RADIUS,
        samplesMaxOf: () => 32,
        airSuns: () => ({ count: 1, list: [] }),
        atmo: () => [1, 1, 1, 1],
        face: { eye: [0, 0, 0, 0], size: [0, 0, 0, preExposure] },
        // Above the air the sky table is not read: the face marches.
        frame: { camera: [0, 0, 0, height] },
        moveToTopAtmosphere: (start: number[]) => [...start, 1],
        integrateAir: () => ({ radiance: [1e6, 40000, 10] }),
      },
    ).skyFaceMain
  assert.equal(SKY_MAX_RADIANCE, 32256)
  assert.deepEqual(skyFaceAt(1)([0, 0, 0, 0]), [SKY_MAX_RADIANCE, SKY_MAX_RADIANCE, 10, 1])
  // The radiance is multiplied by the capture's pre-exposure first and held after it.
  assert.deepEqual(skyFaceAt(0.25)([0, 0, 0, 0]), [SKY_MAX_RADIANCE, 10000, 2.5, 1])
})

test('the sky of a face inside the air is read from the sky table built in the capture’s frame', () => {
  const read: number[][] = []
  const face = shaderRun<{ skyFaceMain: (pixel: number[]) => number[] }>(
    skyFaceProgram(DEFAULT_AIR_SHAPE).code,
    ['skyFaceMain'],
    {
      pixelDirection: () => [0, 1, 0],
      cubeToScene: (dir: number[]) => dir,
      bottomRadius: () => 6360,
      topRadius: () => TOP_RADIUS,
      atmo: () => [2, 2, 2, 2],
      face: { eye: [0, 0, 0, 0], size: [0, 0, 0, 0.5] },
      frame: { camera: [0, 0, 0, 6360.5] },
      skyViewScattered: (dir: number[], height: number) => (
        read.push([...dir, height]),
        [3, 4, 5, 0.1]
      ),
      integrateAir: () => assert.fail('the table is read, nothing is marched'),
    },
  ).skyFaceMain
  // The table's light times the sky factor times the pre-exposure; the table's alpha is not written.
  assert.deepEqual(face([0, 0, 0, 0]), [3, 4, 5, 1])
  assert.deepEqual(read, [[0, 1, 0, 6360.5]])
})
