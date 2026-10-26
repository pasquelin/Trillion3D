// The cubes of a specified-cubemap sky light: written rescaled to fit the half float, the pair of a
// cube and the one it blends to by one scale, a big cube face by face over the images, and the
// captures asked again by the lower hemisphere's colour and coverage.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  mergeModuleParts,
  resolveModuleOption,
} from '../../../../sdk-core/src/modules/descriptor.ts'
import { resolveSky, SKY_MODULE } from '../../../../sdk-core/src/modules/sky/descriptor.ts'
import { DEFAULT_SKY_QUALITY } from '../../../../sdk-core/src/modules/sky/quality.ts'
import {
  resolveSkyLight,
  type SkyLightPart,
} from '../../../../sdk-core/src/modules/sky/skyLight.ts'
import { HALF_MAX } from '../../../../math/src/constants.ts'
import { fromHalf } from '../../../../math/src/float/half.ts'
import { cubemapKey } from '../../modules/sky/skyLight/cubemapKey.ts'
import type { SkyLightInputs } from '../../modules/sky/skyLight/captureInputs.ts'
import {
  lookAtScene,
  newSceneCaptureState,
} from '../../modules/sky/skyLight/captureSceneSchedule.ts'
import type { SkyLightTargets } from '../../modules/sky/skyLight/targets.ts'
import { followSkyCubemaps, type SkyCubemaps } from './skyCubemaps.ts'

const LIGHT = { realTimeCapture: false, sourceType: 'specifiedCubemap' }

/** The sky light of a specified cubemap of `size` texels a side filled with `fill` (a function of
 *  the channel's rank), blending to `destination` at 0.5 when it is given. */
function skyLightOf(
  size: number,
  fill: (i: number) => number,
  destination?: { size: number; texels: Float32Array },
) {
  const texels = new Float32Array(6 * size * size * 3).map((_, i) => fill(i))
  return resolveSky(
    mergeModuleParts(SKY_MODULE, [
      resolveModuleOption(SKY_MODULE, {
        skyLight: {
          ...LIGHT,
          cubemap: { size, texels },
          ...(destination && { cubemapBlend: { destination, fraction: 0.5 } }),
        },
      }) as never,
    ]),
    DEFAULT_SKY_QUALITY,
  ).skyLight!
}

/** A device that records each face written: its texture, its number, a copy of its texels and the
 *  buffer they were written from. */
function recordingDevice() {
  const textures: object[] = []
  const written: { texture: object; face: number; copy: Uint16Array; buffer: Uint16Array }[] = []
  const device = {
    createTexture: () => (textures.push({}), textures.at(-1)),
    queue: {
      writeTexture: (to: { texture: object; origin: number[] }, data: Uint16Array) =>
        written.push({ texture: to.texture, face: to.origin[2], copy: data.slice(), buffer: data }),
    },
  } as unknown as GPUDevice
  return { device, written, textures }
}

test('a specified cubemap with a texel past the half float is written rescaled to fit, the light given the inverse: nothing is clamped, on any device', () => {
  const { device, written } = recordingDevice()
  const bright = skyLightOf(1, (i) => (i === 4 ? 1e6 : 1))
  const cubes = followSkyCubemaps(device, {}, bright)
  assert.ok(cubes.cubemap)
  assert.equal(cubes.cubemapScale, 1e6 / HALF_MAX)
  assert.equal(
    fromHalf(written[1].copy[1]),
    HALF_MAX,
    'the brightest texel is the half float’s largest',
  )
  const ratio = fromHalf(written[0].copy[0]) / fromHalf(written[1].copy[1])
  assert.ok(Math.abs(ratio * 1e6 - 1) < 1e-3, 'every other texel keeps its share of it')
  // A cube within the range is written as it is, the light given no rescale.
  const plain = followSkyCubemaps(
    device,
    {},
    skyLightOf(1, () => 2),
  )
  assert.equal(plain.cubemapScale, 1)
  assert.equal(fromHalf(written.at(-1)!.copy[0]), 2)
})

test('a cube and the one it blends to are written by one scale, the brighter one’s: the mix is of two lights in one unit', () => {
  const { device, written, textures } = recordingDevice()
  const destination = { size: 1, texels: new Float32Array(18).fill(2) }
  const cubes = followSkyCubemaps(
    device,
    {},
    skyLightOf(1, (i) => (i === 4 ? 1e6 : 1), destination),
  )
  const scale = 1e6 / HALF_MAX
  assert.equal(cubes.cubemapScale, scale)
  assert.equal(cubes.blend!.scale, scale, 'the light is given the one scale for both')
  const [source, blended] = textures
  // The destination, 2 everywhere and no brighter than the half float, is written by the source's
  // rescale: 2 over the scale, not 2.
  const face = written.find((w) => w.texture === blended)!
  assert.ok(Math.abs(fromHalf(face.copy[0]) * scale - 2) < 2e-3)
  assert.equal(written.filter((w) => w.texture === source).length, 6)
})

test('a big cube is written face by face over the images from one buffer, and is the light’s once whole', () => {
  const { device, written } = recordingDevice()
  const held: SkyCubemaps = {}
  const part = skyLightOf(512, () => 1)
  const faces = () => written.length
  // 512 texels a side: a face holds 786432 channels, the budget of an image 1048576: two faces.
  assert.equal(followSkyCubemaps(device, held, part).cubemap, undefined)
  assert.deepEqual([faces(), held.pending], [2, true])
  assert.equal(followSkyCubemaps(device, held, part).cubemap, undefined)
  assert.deepEqual([faces(), held.pending], [4, true])
  const whole = followSkyCubemaps(device, held, part)
  assert.ok(whole.cubemap, 'the sixth face lands: the light has its cube')
  assert.deepEqual([faces(), held.pending], [6, false])
  assert.deepEqual(
    written.map((w) => w.face),
    [0, 1, 2, 3, 4, 5],
  )
  assert.ok(
    written.every((w) => w.buffer === written[0].buffer),
    'one buffer for every face',
  )
  // Nothing more is written once whole.
  followSkyCubemaps(device, held, part)
  assert.equal(faces(), 6)
})

/** The inputs a capture is keyed by, of a light whose fields are `fields`. */
function inputs(fields: Record<string, unknown>) {
  const part: SkyLightPart = resolveSkyLight({ ...LIGHT, ...fields }, DEFAULT_SKY_QUALITY)
  return { part } as unknown as SkyLightInputs
}

test('a specified cubemap is captured again when its lower hemisphere’s colour or coverage changes', () => {
  const cube = {} as GPUTexture
  const targets = { width: 128 } as SkyLightTargets
  const key = (fields: Record<string, unknown>) => cubemapKey(cube, targets, inputs(fields), 1)
  const base = key({})
  assert.deepEqual(key({}), base, 'the same light, the same key')
  assert.notDeepEqual(key({ lowerHemisphereCoverage: 0.4 }), base)
  assert.notDeepEqual(key({ lowerHemisphereColor: [0.2, 0, 0] }), base)
})

test('a captured scene is asked again when its lower hemisphere’s colour or coverage changes, not for its flag', () => {
  const look = (fields: Record<string, unknown>) =>
    lookAtScene(state, inputs({ sourceType: 'capturedScene', realTimeCapture: false, ...fields }))
  const state = newSceneCaptureState()
  assert.equal(look({}), true, 'the first look asks')
  state.due = false
  assert.equal(look({}), false, 'the same light asks nothing')
  assert.equal(look({ lowerHemisphereCoverage: 0.4 }), true)
  state.due = false
  assert.equal(look({ lowerHemisphereCoverage: 0.4, lowerHemisphereColor: [0.2, 0, 0] }), true)
  state.due = false
  assert.equal(look({ lowerHemisphereCoverage: 0.4, lowerHemisphereColor: [0.2, 0, 0] }), false)
})
