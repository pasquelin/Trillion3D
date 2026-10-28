// A build made once a device is shared; a failed one — rejected or made nothing — is not. The blue noise is the
// build that is shared most (`../noise/`): its file, its textures, made once a device, and how a pass reads them.
import test from 'node:test'
import assert from 'node:assert/strict'
import { oncePerDevice, oncePerDeviceKey } from './oncePerDevice.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import {
  bandMean,
  spatialSpectrum,
  temporalSpectrum,
} from '../../../../math/src/sequence/noiseSpectrum.fixture.ts'
import { blueNoiseFile } from '../noise/blueNoise.fixture.ts'
import { BLUE_NOISE_BYTES, BLUE_NOISE_PIXELS } from '../noise/blueNoiseSource.ts'
import { BLUE_NOISE_FORMAT, blueNoiseNow, blueNoiseTextures } from '../noise/blueNoiseTextures.ts'
import { blueNoiseWgsl } from '../noise/blueNoiseWgsl.ts'

test('a device keeps what was made, never a failed build', async () => {
  const device = {} as GPUDevice
  const builds = [
    () => undefined,
    () => {
      throw new Error('lost')
    },
    () => 'made',
  ]
  let calls = 0
  const make = oncePerDevice(async () => builds[calls++]())
  for (const expected of [undefined, 'reject', 'made', 'made'])
    if (expected === 'reject') await assert.rejects(make(device) as Promise<unknown>)
    else assert.equal(await make(device), expected)
  assert.equal(calls, 3)
})

test('a device keeps what was made for each key, and a failed build of one key is made again', async () => {
  const device = {} as GPUDevice
  const calls: string[] = []
  const make = oncePerDeviceKey(async (_device, key: string) => {
    calls.push(key)
    if (key === 'lost' && calls.indexOf('lost') === calls.lastIndexOf('lost'))
      throw new Error('lost')
    return key
  })
  assert.equal(await make(device, 'a'), 'a')
  assert.equal(await make(device, 'a'), 'a')
  assert.equal(await make(device, 'b'), 'b')
  await assert.rejects(make(device, 'lost') as Promise<unknown>)
  assert.equal(await make(device, 'lost'), 'lost')
  assert.deepEqual(calls, ['a', 'b', 'lost', 'lost'])
})

test('the blue noise file holds the two masks: the scalar one each value as often as any, blue in every image and along the frames, the vector one blue too', () => {
  assert.equal(blueNoiseFile.length, BLUE_NOISE_BYTES)
  const scalar = blueNoiseFile.subarray(0, BLUE_NOISE_PIXELS)
  const counts = new Uint32Array(256)
  for (const value of scalar) counts[value]++
  assert.ok(
    counts.every((count) => count === BLUE_NOISE_PIXELS / 256),
    'each of the 256 values 4096 times',
  )
  const frames = [0, 8, 16, 24, 32, 40, 48, 56]
  const space = spatialSpectrum(scalar, 128, frames)
  const time = temporalSpectrum(scalar, 128, 64, 8)
  // A mask of white noise holds 1 everywhere; this one holds almost none of the low frequencies, and more than white noise of the high.
  assert.ok(bandMean(space, 1, 12) < 0.02, `scalar, low spatial: ${bandMean(space, 1, 12)}`)
  assert.ok(bandMean(space, 54, 64) > 1.1, `scalar, high spatial: ${bandMean(space, 54, 64)}`)
  assert.ok(bandMean(time, 1, 4) < 0.05, `scalar, low temporal: ${bandMean(time, 1, 4)}`)
  assert.ok(bandMean(time, 24, 32) > 1.3, `scalar, high temporal: ${bandMean(time, 24, 32)}`)
  for (const channel of [0, 1]) {
    const vector = new Uint8Array(BLUE_NOISE_PIXELS)
    for (let pixel = 0; pixel < BLUE_NOISE_PIXELS; pixel++)
      vector[pixel] = blueNoiseFile[BLUE_NOISE_PIXELS + 2 * pixel + channel]
    const mean = vector.reduce((sum, value) => sum + value, 0) / vector.length
    assert.ok(Math.abs(mean - 127.5) < 1, `vector ${channel}: uniform, mean ${mean}`)
    const low = bandMean(spatialSpectrum(vector, 128, frames), 1, 12)
    const lowTime = bandMean(temporalSpectrum(vector, 128, 64, 8), 1, 4)
    assert.ok(low < 0.05 && lowTime < 0.1, `vector ${channel}: ${low} in space, ${lowTime} in time`)
  }
})

test('the blue noise is one texture of 128 by 8192 texels, a mask frame after frame: the scalar mask in the red channel, the vector mask in the green and the blue', () => {
  const gpu = fakeDevice()
  // The file was read by the kit, as the host would: the device makes its textures at the first ask.
  const made = blueNoiseNow(gpu.device)!
  assert.deepEqual(
    gpu.textures.map(({ format, width, height }) => [format, width, height]),
    [[BLUE_NOISE_FORMAT, 128, 8192]],
  )
  assert.equal(gpu.textureWrites.length, 1)
  const [{ layout, data }] = gpu.textureWrites
  assert.deepEqual([layout.bytesPerRow, data.length], [512, BLUE_NOISE_PIXELS * 4])
  for (const pixel of [0, 1, 777, 128 * 128 * 64 - 1])
    assert.deepEqual(
      Array.from(data.slice(4 * pixel, 4 * pixel + 4)),
      [
        blueNoiseFile[pixel],
        blueNoiseFile[BLUE_NOISE_PIXELS + 2 * pixel],
        blueNoiseFile[BLUE_NOISE_PIXELS + 2 * pixel + 1],
        255,
      ],
      `pixel ${pixel}`,
    )
  assert.ok(made.view)
})

test('the blue noise is read at the texel the pixel and the frame wrap onto — x mod 128, frame mod 64 times 128 plus y mod 128 — the scalar mask from its channel and the vector one from its own', () => {
  const reads: number[][] = []
  const texel = (_: string, [x, y]: number[]) => {
    reads.push([x, y])
    const at = y * 128 + x
    return [
      blueNoiseFile[at] / 255,
      blueNoiseFile[BLUE_NOISE_PIXELS + 2 * at] / 255,
      blueNoiseFile[BLUE_NOISE_PIXELS + 2 * at + 1] / 255,
      1,
    ]
  }
  const { blueNoiseScalar, blueNoiseVec2 } = shaderRun<{
    blueNoiseScalar: (coord: number[], frame: number) => number
    blueNoiseVec2: (coord: number[], frame: number) => number[]
  }>(wgslModule(blueNoiseWgsl(0, 1)), ['blueNoiseScalar', 'blueNoiseVec2'], {
    blueNoiseMask: 'mask',
    textureLoad: texel,
  })
  for (const [coord, frame, at] of [
    [[0, 0], 0, [0, 0]],
    [[127, 127], 63, [127, 63 * 128 + 127]],
    [[128, 5], 64, [0, 5]],
    [[300, 1000], 200, [44, 8 * 128 + 104]],
    [[17, 3], 1_000_003, [17, (1_000_003 % 64) * 128 + 3]],
  ] as const) {
    reads.length = 0
    const one = blueNoiseScalar([...coord], frame)
    const two = blueNoiseVec2([...coord], frame)
    assert.deepEqual(reads, [[...at], [...at]], `${coord} at ${frame}`)
    const pixel = at[1] * 128 + at[0]
    assert.equal(one, blueNoiseFile[pixel] / 255)
    assert.deepEqual(two, [
      blueNoiseFile[BLUE_NOISE_PIXELS + 2 * pixel] / 255,
      blueNoiseFile[BLUE_NOISE_PIXELS + 2 * pixel + 1] / 255,
    ])
  }
})

test('the blue noise is made once a device and shared by every pass that asks for it, the same view for the shadows and the probes', async () => {
  const gpu = fakeDevice()
  // The file was read (by the kit, as the host would): a device makes its textures at the first ask.
  const first = blueNoiseNow(gpu.device)
  assert.ok(first, 'made at once')
  assert.equal(await blueNoiseTextures(gpu.device), first)
  assert.equal(blueNoiseNow(gpu.device), first)
  assert.equal(gpu.textures.length, 1, 'one texture, made once')
  const other = fakeDevice()
  assert.notEqual(blueNoiseNow(other.device), first, 'a device its own')
})
