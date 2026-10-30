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
import type { SkyLightCubemap } from '../../../../sdk-core/src/modules/sky/skyLightCubemap.ts'
import { HALF_MAX } from '../../../../math/src/constants.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { BACKEND } from '../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import { CUBE_HALF_ENTRY } from '../../modules/sky/skyLight/cubeHalfWgsl.ts'
import { cubePeak, takeFloatCube } from '../../modules/sky/skyLight/cubePeak.ts'
import { cubePeakKernel } from '../../modules/sky/skyLight/cubePeak.fixture.ts'
import { cubemapKey } from '../../modules/sky/skyLight/cubemapKey.ts'
import type { SkyLightInputs } from '../../modules/sky/skyLight/captureInputs.ts'
import {
  lookAtScene,
  newSceneCaptureState,
} from '../../modules/sky/skyLight/captureSceneSchedule.ts'
import type { SkyLightTargets } from '../../modules/sky/skyLight/targets.ts'
import { followSkyCubemaps, releaseSkyCubemaps, type SkyCubemaps } from './skyCubemaps.ts'

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

/** A fake device whose last-mip kernel answers the cube peak, recording each face written as half floats: its texture, its number, a copy
 *  of its texels and the buffer they were written from. */
function recordingDevice() {
  const gpu: ReturnType<typeof fakeDevice> = fakeDevice({
    ...BACKEND,
    kernel: cubePeakKernel(() => gpu.textureWrites),
  })
  const { device } = gpu
  const written: { texture: object; face: number; copy: Uint16Array; buffer: Uint16Array }[] = []
  const writeTexture = device.queue.writeTexture.bind(device.queue) as (...args: unknown[]) => void
  ;(device.queue as { writeTexture: unknown }).writeTexture = (
    to: { texture: object; origin: number[] },
    data: unknown,
    ...rest: unknown[]
  ) => {
    // The cubes' half floats; the float copies the GPU reduces for the peak are not.
    if (data instanceof Uint16Array)
      written.push({ texture: to.texture, face: to.origin[2], copy: data.slice(), buffer: data })
    writeTexture(to, data, ...rest)
  }
  /** The images it takes for the peaks to be back and the first faces written, the compile and readbacks awaited between two. */
  async function follow(held: SkyCubemaps, part: SkyLightPart) {
    for (let image = 0; image < 10_000; image++) {
      const cubes = followSkyCubemaps(device, held, part)
      if (held.source) return cubes
      await new Promise((resolve) => setTimeout(resolve))
    }
    throw new Error('the peak never came back')
  }
  const cubeTextures = () => gpu.textures.filter((texture) => texture.format === 'rgba16float')
  return { gpu, device, written, follow, cubeTextures }
}

/** The scale each conversion of a float cube to half floats was dispatched with, in order (`convertCubeHalf`). */
const converted = (gpu: ReturnType<typeof fakeDevice>) =>
  gpu.writes.filter((w) => w.buffer.label === 'Trillion3D cube half').map((w) => w.data[0])

/** Takes the float cube of `cube` away as the ambient cubemap does, once its peak is back: the light has to write the cube from the CPU. */
async function takeFloats(device: GPUDevice, cube: SkyLightCubemap) {
  for (let image = 0; image < 10_000; image++) {
    if (cubePeak(device, cube, TAKER, true) !== undefined) return takeFloatCube(device, cube)
    await new Promise((resolve) => setTimeout(resolve))
  }
  throw new Error('the peak never came back')
}
const TAKER = {}

test('a specified cubemap with a texel past the half float is converted on the GPU from the cube its peak was found over, rescaled to fit, the light given the inverse: nothing is clamped, nothing written twice', async () => {
  const { gpu, written, follow } = recordingDevice()
  const bright = skyLightOf(1, (i) => (i === 4 ? 1e6 : 1))
  const cubes = await follow({}, bright)
  assert.ok(cubes.cubemap)
  assert.equal(cubes.cubemapScale, 1e6 / HALF_MAX)
  assert.equal(
    written.length,
    0,
    'no face written from the CPU: the float cube is converted where it is',
  )
  assert.deepEqual(
    gpu.dispatches.filter((d) => d.entryPoint === CUBE_HALF_ENTRY).map((d) => d.direct),
    [1],
  )
  assert.ok(Math.abs(converted(gpu)[0] / (HALF_MAX / 1e6) - 1) < 1e-6, 'times the fit’s scale')
  // A cube within the range is converted as it is, the light given no rescale.
  const plain = await follow(
    {},
    skyLightOf(1, () => 2),
  )
  assert.equal(plain.cubemapScale, 1)
  assert.equal(converted(gpu).at(-1), 1)
})

test('a cube and the one it blends to are converted by one scale, the brighter one’s: the mix is of two lights in one unit', async () => {
  const { gpu, follow } = recordingDevice()
  const destination = { size: 1, texels: new Float32Array(18).fill(2) }
  const cubes = await follow(
    {},
    skyLightOf(1, (i) => (i === 4 ? 1e6 : 1), destination),
  )
  const scale = 1e6 / HALF_MAX
  assert.equal(cubes.cubemapScale, scale)
  assert.equal(cubes.blend!.scale, scale, 'the light is given the one scale for both')
  const fits = converted(gpu)
  assert.equal(fits.length, 2)
  assert.ok(
    fits.every((fit) => fit === fits[0]),
    'the destination is converted by the source’s rescale',
  )
  assert.ok(Math.abs(fits[0] * scale - 1) < 1e-6)
})

test('a big cube whose float cube is gone is written face by face over the images from one buffer, and is the light’s once whole', async () => {
  const { device, written, follow } = recordingDevice()
  const held: SkyCubemaps = {}
  const part = skyLightOf(512, () => 1)
  await takeFloats(device, part.cubemap!)
  const faces = () => written.length
  // 512 texels a side: a face holds 786432 channels, the budget of an image 1048576: two faces, once the peak is back.
  assert.equal((await follow(held, part)).cubemap, undefined)
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

test('both cubes of a pair start their reduction in the same image, none waiting for the other', () => {
  const { device, gpu } = recordingDevice()
  const destination = { size: 4, texels: new Float32Array(6 * 16 * 3).fill(2) }
  followSkyCubemaps(
    device,
    {},
    skyLightOf(4, () => 1, destination),
  )
  const peaks = gpu.textures.filter((texture) => texture.label === 'Trillion3D cube peak')
  assert.equal(peaks.length, 2)
})

test('while a peak is pending the cubes already held are kept, the image drawn again, and a picture given up destroys its measure at once', async () => {
  const { device, follow } = recordingDevice()
  const held: SkyCubemaps = {}
  const first = await follow(
    held,
    skyLightOf(1, () => 1),
  )
  assert.ok(first.cubemap)
  const kept = held.source
  const next = followSkyCubemaps(
    device,
    held,
    skyLightOf(1, () => 3),
  )
  assert.equal(next.cubemap, first.cubemap, 'no cube dropped, none black')
  assert.equal(held.source, kept)
  assert.equal(held.pending, true)
  // The whole old configuration is kept, the share of a blend that is new included, until the new pair is ready.
  const blending = skyLightOf(1, () => 3, { size: 1, texels: new Float32Array(18).fill(4) })
  assert.deepEqual(followSkyCubemaps(device, held, blending), first, 'no new blend meanwhile')
})

test('a picture given up before its peak is back destroys its measure at once', () => {
  const { device, gpu } = recordingDevice()
  const held: SkyCubemaps = {}
  followSkyCubemaps(
    device,
    held,
    skyLightOf(1, () => 1),
  )
  const measure = gpu.textures.find((texture) => texture.label === 'Trillion3D cube peak')!
  assert.ok(!gpu.destroyed.includes(measure), 'alive while its kernels compile')
  followSkyCubemaps(
    device,
    held,
    skyLightOf(1, () => 5),
  )
  assert.ok(gpu.destroyed.includes(measure))
  releaseSkyCubemaps(device, held)
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
