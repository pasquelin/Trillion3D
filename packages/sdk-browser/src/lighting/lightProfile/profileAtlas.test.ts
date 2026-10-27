// The atlas on the GPU: a 2D array of half-float slices of the reference's capacity, made once, written
// when profiles come.
import test from 'node:test'
import assert from 'node:assert/strict'
import { BACKEND } from '../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { postSamplers } from '../../gpu/core/postSamplers.ts'
import { createLightProfileAtlas, PROFILE_ATLAS_FORMAT } from './profileAtlas.ts'
import { PROFILE_SIDE, type LightProfileData } from './profileFile.ts'
import { PROFILE_ATLAS_MAX_SLICES } from './profileSlots.ts'

const profile = (fill: number, brightness = 1): LightProfileData => ({
  brightness,
  texels: new Uint16Array(PROFILE_SIDE * PROFILE_SIDE).fill(fill),
})

test('the atlas is made once at the reference’s capacity, of half-floats, with the shared clamped sampler', () => {
  const gpu = fakeDevice(BACKEND)
  const atlas = createLightProfileAtlas(gpu.device)
  assert.equal(gpu.textures.length, 0, 'nothing is made before it is asked')
  assert.ok(atlas.view)
  assert.equal(gpu.textures.length, 1)
  const [made] = gpu.textures
  assert.deepEqual(
    [made.width, made.height, made.depthOrArrayLayers],
    [256, 256, PROFILE_ATLAS_MAX_SLICES],
  )
  assert.equal(made.format, PROFILE_ATLAS_FORMAT)
  assert.equal(PROFILE_ATLAS_FORMAT, 'r16float')
  assert.ok(made.usage & GPUTextureUsage.TEXTURE_BINDING)
  assert.ok(made.usage & GPUTextureUsage.COPY_DST)
  assert.equal(atlas.view, atlas.view, 'one view')
  assert.equal(atlas.sampler, postSamplers(gpu.device).clamped)
})

test('profiles are written into their slices as they are, and the texture is made by the first sync alone', () => {
  const gpu = fakeDevice(BACKEND)
  const atlas = createLightProfileAtlas(gpu.device)
  atlas.slots.add('a', profile(0x3c00))
  atlas.slots.add('b', profile(0x3800))
  assert.equal(atlas.sync(), true)
  assert.equal(gpu.textures.length, 1)
  assert.deepEqual(
    gpu.textureWrites.map((write) => write.destination.origin),
    [
      [0, 0, atlas.slots.sliceOf('a')],
      [0, 0, atlas.slots.sliceOf('b')],
    ],
  )
  const [first, second] = gpu.textureWrites
  assert.deepEqual([...first.data.slice(0, 2)], [0x3c00, 0x3c00])
  assert.deepEqual([...second.data.slice(0, 2)], [0x3800, 0x3800])
  assert.deepEqual(first.layout, { bytesPerRow: 512, rowsPerImage: 256 })
  assert.deepEqual(first.size, [256, 256, 1])
  assert.equal(atlas.sync(), false, 'nothing came: nothing is written')
  assert.equal(gpu.textureWrites.length, 2)
  // Another profile fits a free slice: the texture is the same.
  const view = atlas.view
  atlas.slots.add('c', profile(0x3400))
  assert.equal(atlas.sync(), false)
  assert.equal(atlas.view, view)
  assert.equal(gpu.textures.length, 1)
})

test('freeing a profile leaves the texture, and the next profile takes its slice', () => {
  const gpu = fakeDevice(BACKEND)
  const atlas = createLightProfileAtlas(gpu.device, 2)
  atlas.slots.add('a', profile(0x3c00))
  atlas.slots.add('b', profile(0x3800))
  atlas.sync()
  atlas.slots.add('c', profile(0x3400))
  atlas.sync()
  assert.equal(atlas.slots.sliceOf('c'), -1, 'over the capacity')
  const slice = atlas.slots.sliceOf('a')
  atlas.slots.remove('a')
  atlas.sync()
  assert.equal(atlas.slots.sliceOf('c'), slice)
  assert.deepEqual(gpu.textureWrites.at(-1)!.destination.origin, [0, 0, slice])
  assert.equal(gpu.textures.length, 1)
})
