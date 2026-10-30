// The cube's brightest channel reduced on the GPU (`cubePeak.ts`, `cubePeakWgsl.ts`): the kernels' shipped WGSL text run in JavaScript against a
// plain maximum of the texels, for a side that halves evenly and for odd ones; the reduction's passes; the peak found once for a cube's texels.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { BACKEND } from '../../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import { lcgRandom } from '../../../../../math/src/sequence/random.ts'
import { mipSize } from '../../../../../math/src/scalar/integers.ts'
import { cubemapMipCount } from '../../../../../sdk-core/src/scene/core/fogCubemap.ts'
import { assertProgramAssembles } from '../../../gpu/core/wgslNames.fixture.ts'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import { abandonCubePeak, cubePeak, takeFloatCube } from './cubePeak.ts'
import { cubePeakKernel } from './cubePeak.fixture.ts'
import {
  CUBE_DOWNSAMPLE_MAX_ENTRY,
  CUBE_MAX_LUMINANCE_ENTRY,
  cubeDownsampleMaxShader,
  cubeMaxLuminanceShader,
} from './cubePeakWgsl.ts'

/** A mip of `side` texels a face: four channels a texel, six faces, row by row. */
type Mip = { side: number; texels: number[][] }

const mipOf = (side: number, fill: () => number): Mip => ({
  side,
  texels: Array.from({ length: 6 * side * side }, () => [fill(), fill(), fill(), 1]),
})

/** The shipped downsampling kernel run over every texel of the mip below `source`, `side` texels across. */
function downsampled(source: Mip, side: number) {
  const out = Array.from({ length: 6 * side * side }, () => [0, 0, 0, 0])
  const target = { side }
  const kernel = shaderRun<Record<string, (id: number[]) => void>>(
    cubeDownsampleMaxShader(),
    [CUBE_DOWNSAMPLE_MAX_ENTRY],
    {
      maxSource: source,
      maxReduced: target,
      textureDimensions: (texture: { side: number }) => [texture.side, texture.side],
      textureLoad: (_texture: unknown, at: number[], face: number) =>
        source.texels[(face * source.side + at[1]) * source.side + at[0]],
      textureStore: (_texture: unknown, at: number[], face: number, value: number[]) => {
        out[(face * side + at[1]) * side + at[0]] = value
      },
    },
  )
  for (let face = 0; face < 6; face++)
    for (let y = 0; y < side; y++)
      for (let x = 0; x < side; x++) kernel[CUBE_DOWNSAMPLE_MAX_ENTRY]([x, y, face])
  return { side, texels: out } as Mip
}

test('every texel of a mip is the largest of the texels it covers, so the last mip holds the cube’s largest channels, for any side', () => {
  const random = lcgRandom(4101)
  for (const size of [1, 2, 8, 5, 12, 33]) {
    let mip = mipOf(size, random)
    const expected = Math.max(...mip.texels.flatMap(([r, g, b]) => [r, g, b]))
    for (let level = 1; level < cubemapMipCount(size); level++)
      mip = downsampled(mip, mipSize(size, level))
    assert.equal(mip.side, 1)
    const found = Math.max(...mip.texels.flatMap(([r, g, b]) => [r, g, b]))
    assert.equal(found, expected, `side ${size}`)
  }
})

test('the last mip’s six faces are reduced to the largest red, green or blue, alpha left out', () => {
  const faces = [0, 1, 2, 3, 4, 5].map((face) => [face === 3 ? 7.5 : 1, 2, face === 5 ? 6 : 0, 100])
  const out: number[] = []
  const kernel = shaderRun<Record<string, () => void>>(
    cubeMaxLuminanceShader(),
    [CUBE_MAX_LUMINANCE_ENTRY],
    {
      lastMip: {},
      cubePeakOut: out,
      textureLoad: (_texture: unknown, _at: number[], face: number) => faces[face],
    },
  )
  kernel[CUBE_MAX_LUMINANCE_ENTRY]()
  assert.equal(out[0], 7.5)
})

test('the kernels’ programs declare every name they use and name their entries', () => {
  assertProgramAssembles(cubeDownsampleMaxShader(), CUBE_DOWNSAMPLE_MAX_ENTRY, 'the downsampling')
  assertProgramAssembles(cubeMaxLuminanceShader(), CUBE_MAX_LUMINANCE_ENTRY, 'the last mip')
})

/** Asks for the peak each image, the compile and the readback awaited between two, until it lands. */
const OWNER = {}
async function peakOf(
  device: GPUDevice,
  cube: { size: number; texels: Float32Array },
  owner: object = OWNER,
  keep = false,
) {
  for (let image = 0; image < 10_000; image++) {
    const peak = cubePeak(device, cube, owner, keep)
    if (peak !== undefined) return peak
    await new Promise((resolve) => setTimeout(resolve))
  }
  throw new Error('the peak never came back')
}

test('the peak is reduced on the GPU once for a cube’s texels: every mip, then the last, one float copied back', async () => {
  const gpu: ReturnType<typeof fakeDevice> = fakeDevice({
    ...BACKEND,
    kernel: cubePeakKernel(() => gpu.textureWrites),
  })
  const size = 8
  const texels = new Float32Array(6 * size * size * 3).fill(0.5)
  texels[100] = 40
  const cube = { size, texels }
  assert.equal(cubePeak(gpu.device, cube, OWNER), undefined, 'not known the image it is asked')
  assert.equal(await peakOf(gpu.device, cube), 40)
  // The cube's mips: three downsamplings (4, 2, 1 texels), one dispatch a mip, the six faces along z, and the last mip's kernel.
  assert.deepEqual(
    gpu.dispatches.map((d) => d.entryPoint),
    [...Array(cubemapMipCount(size) - 1).fill(CUBE_DOWNSAMPLE_MAX_ENTRY), CUBE_MAX_LUMINANCE_ENTRY],
  )
  assert.equal(gpu.copies.length, 1)
  assert.equal(gpu.copies[0].size, 4)
  assert.equal(gpu.textureWrites.length, 6, 'the six faces went up as floats')
  const peak = gpu.textures.find((texture) => texture.label === 'Trillion3D cube peak')!
  assert.equal(peak.format, 'rgba32float')
  assert.equal(peak.mipLevelCount, cubemapMipCount(size))
  // Found once: asked again, it reduces nothing more.
  assert.equal(cubePeak(gpu.device, cube, OWNER), 40)
  assert.equal(gpu.dispatches.length, cubemapMipCount(size))
  assert.equal(gpu.textures.length, 1)
})

test('a readback the device refuses is not waited for forever: the reduction is made again', async () => {
  const gpu: ReturnType<typeof fakeDevice> = fakeDevice({
    ...BACKEND,
    failMap: true,
    kernel: cubePeakKernel(() => gpu.textureWrites),
  })
  const cube = { size: 4, texels: new Float32Array(6 * 4 * 4 * 3).fill(1) }
  for (let image = 0; image < 200; image++) {
    assert.equal(cubePeak(gpu.device, cube, OWNER), undefined)
    await new Promise((resolve) => setTimeout(resolve))
  }
  const reductions = gpu.dispatches.filter((d) => d.entryPoint === CUBE_MAX_LUMINANCE_ENTRY)
  assert.ok(reductions.length > 1, 'asked again after the refusal')
})

test('a measure given up before the GPU returns it destroys its float cube at once', () => {
  const gpu = fakeDevice(BACKEND)
  const cube = { size: 4, texels: new Float32Array(6 * 4 * 4 * 3) }
  assert.equal(cubePeak(gpu.device, cube, OWNER), undefined)
  const measure = gpu.textures.find((texture) => texture.label === 'Trillion3D cube peak')!
  assert.ok(!gpu.destroyed.includes(measure))
  abandonCubePeak(gpu.device, cube, OWNER)
  assert.ok(gpu.destroyed.includes(measure))
})

test('a measure shared by two owners is destroyed when the last lets go, not the first', () => {
  const gpu = fakeDevice(BACKEND)
  const cube = { size: 4, texels: new Float32Array(6 * 4 * 4 * 3) }
  const other = {}
  cubePeak(gpu.device, cube, OWNER)
  cubePeak(gpu.device, cube, other)
  const measure = gpu.textures.find((texture) => texture.label === 'Trillion3D cube peak')!
  abandonCubePeak(gpu.device, cube, OWNER)
  assert.ok(!gpu.destroyed.includes(measure), 'the other owner still waits for it')
  abandonCubePeak(gpu.device, cube, other)
  assert.ok(gpu.destroyed.includes(measure))
})

test('the float cube is kept for an owner that asks for it and handed over once, the peak back: it goes up once for both', async () => {
  const gpu: ReturnType<typeof fakeDevice> = fakeDevice({
    ...BACKEND,
    kernel: cubePeakKernel(() => gpu.textureWrites),
  })
  const cube = { size: 4, texels: new Float32Array(6 * 4 * 4 * 3).fill(1) }
  const sky = {}
  await peakOf(gpu.device, cube, OWNER, true)
  cubePeak(gpu.device, cube, sky)
  const measure = gpu.textures.find((texture) => texture.label === 'Trillion3D cube peak')!
  assert.ok(!gpu.destroyed.includes(measure), 'kept for the owner that wants it')
  assert.equal(takeFloatCube(gpu.device, cube), measure)
  assert.equal(takeFloatCube(gpu.device, cube), undefined, 'handed over once')
  assert.equal(cubePeak(gpu.device, cube, sky), 1, 'the peak stays known')
  assert.equal(gpu.textureWrites.length, 6)
})

test('the cube’s float copy is let go of once the reduction is submitted', async () => {
  const gpu: ReturnType<typeof fakeDevice> = fakeDevice({
    ...BACKEND,
    kernel: cubePeakKernel(() => gpu.textureWrites),
  })
  const cube = { size: 4, texels: new Float32Array(6 * 4 * 4 * 3).fill(1) }
  await peakOf(gpu.device, cube)
  assert.equal(takeFloatCube(gpu.device, cube), undefined)
  const measure = gpu.textures.find((texture) => texture.label === 'Trillion3D cube peak')!
  assert.ok(gpu.destroyed.includes(measure))
})

test('the float cube is kept whatever order the owners first asked in: the one that keeps registers after the one that does not', async () => {
  const gpu: ReturnType<typeof fakeDevice> = fakeDevice({
    ...BACKEND,
    kernel: cubePeakKernel(() => gpu.textureWrites),
  })
  const cube = { size: 4, texels: new Float32Array(6 * 4 * 4 * 3).fill(1) }
  const sky = {}
  const ambient = {}
  // The sky does not keep and asks first; the reduction is submitted before the ambient cubemap asks.
  for (let image = 0; image < 10_000 && !gpu.dispatches.length; image++) {
    cubePeak(gpu.device, cube, sky)
    await new Promise((resolve) => setTimeout(resolve))
  }
  const measure = gpu.textures.find((texture) => texture.label === 'Trillion3D cube peak')!
  assert.ok(
    !gpu.destroyed.includes(measure),
    'the peak is not back: the cube waits for every owner',
  )
  await peakOf(gpu.device, cube, ambient, true)
  cubePeak(gpu.device, cube, sky)
  assert.equal(takeFloatCube(gpu.device, cube), measure)
})

test('a measure is of one device: two devices measuring the same texels do not release each other, none is handed a foreign float cube', async () => {
  const first: ReturnType<typeof fakeDevice> = fakeDevice({
    ...BACKEND,
    kernel: cubePeakKernel(() => first.textureWrites),
  })
  const second: ReturnType<typeof fakeDevice> = fakeDevice({
    ...BACKEND,
    kernel: cubePeakKernel(() => second.textureWrites),
  })
  const cube = { size: 4, texels: new Float32Array(6 * 4 * 4 * 3).fill(3) }
  const a = {}
  const b = {}
  cubePeak(first.device, cube, a, true)
  cubePeak(second.device, cube, b, true)
  assert.equal(await peakOf(first.device, cube, a, true), 3)
  assert.equal(await peakOf(second.device, cube, b, true), 3)
  const own = first.textures.find((texture) => texture.label === 'Trillion3D cube peak')
  assert.ok(
    !first.destroyed.includes(own!),
    'the float cube of the first device is not released by the second',
  )
  assert.equal(takeFloatCube(first.device, cube), own)
  assert.equal(
    takeFloatCube(second.device, cube),
    second.textures.find((t) => t.label === 'Trillion3D cube peak'),
  )
})
