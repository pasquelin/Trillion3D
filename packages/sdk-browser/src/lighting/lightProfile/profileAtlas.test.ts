// The atlas on the GPU: a 2D array of half-float slices, as many as the profiles asked up to the most the settings allow, made again
// when more are asked, written when profiles come.
import test from 'node:test'
import assert from 'node:assert/strict'
import { BACKEND } from '../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { postSamplers } from '../../gpu/core/postSamplers.ts'
import { createLightProfileAtlas, PROFILE_ATLAS_FORMAT } from './profileAtlas.ts'
import { PROFILE_SIDE, type LightProfileData } from './profileCodec.ts'

const profile = (fill: number): LightProfileData => ({
  texels: new Uint16Array(PROFILE_SIDE * PROFILE_SIDE).fill(fill),
})

test('the atlas is made by the first sync with the slices the profiles ask, of half-floats, with the shared clamped sampler', () => {
  const gpu = fakeDevice(BACKEND)
  const atlas = createLightProfileAtlas(gpu.device)
  assert.equal(gpu.textures.length, 0, 'nothing is made before it is asked')
  atlas.slots.add('a', profile(0x3c00))
  atlas.slots.add('b', profile(0x3800))
  assert.equal(atlas.sync(256, 32), true)
  assert.ok(atlas.view)
  assert.equal(gpu.textures.length, 1)
  const [made] = gpu.textures
  assert.deepEqual([made.width, made.height, made.depthOrArrayLayers], [256, 256, 2])
  assert.equal(made.format, PROFILE_ATLAS_FORMAT)
  assert.equal(PROFILE_ATLAS_FORMAT, 'r16float')
  assert.ok(made.usage & GPUTextureUsage.TEXTURE_BINDING)
  assert.ok(made.usage & GPUTextureUsage.COPY_DST)
  assert.equal(atlas.view, atlas.view, 'one view')
  assert.equal(atlas.sampler, postSamplers(gpu.device).clamped)
})

test('the slices are the profiles asked up to the most allowed, one at least, and the atlas is made again only when more are asked', () => {
  const gpu = fakeDevice(BACKEND)
  const atlas = createLightProfileAtlas(gpu.device)
  assert.equal(atlas.sync(256, 32), false, 'no profile: nothing is made')
  assert.equal(gpu.textures.length, 0)
  atlas.slots.add('a', profile(0x3c00))
  assert.equal(atlas.sync(256, 2), true, 'a profile asked')
  assert.equal(gpu.textures[0].depthOrArrayLayers, 1)
  atlas.slots.add('b', profile(0x3800))
  assert.equal(atlas.sync(256, 2), true)
  atlas.slots.add('c', profile(0x3400))
  assert.equal(atlas.sync(256, 2), false, 'past the most allowed: the atlas stays')
  assert.equal(gpu.textures.at(-1)!.depthOrArrayLayers, 2)
  assert.equal(atlas.slots.sliceOf('c'), -1, 'and the profile past it has no slice')
  const made = gpu.textures.length
  atlas.slots.remove('a')
  assert.equal(atlas.sync(256, 2), false, 'a profile freed leaves the texture')
  assert.equal(gpu.textures.length, made)
  assert.ok(atlas.slots.sliceOf('c') >= 0, 'and the next takes its slice')
})

test('profiles are written into their slices as they are, and a new profile in a free slice leaves the texture', () => {
  const gpu = fakeDevice(BACKEND)
  const atlas = createLightProfileAtlas(gpu.device)
  atlas.slots.add('a', profile(0x3c00))
  atlas.slots.add('b', profile(0x3800))
  assert.equal(atlas.sync(256, 32), true)
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
  assert.equal(atlas.sync(256, 32), false, 'nothing came: nothing is written')
  assert.equal(gpu.textureWrites.length, 2)
  atlas.slots.remove('a')
  atlas.sync(256, 32)
  const view = atlas.view
  atlas.slots.add('c', profile(0x3400))
  assert.equal(atlas.sync(256, 32), false, 'the freed slice is taken')
  assert.equal(atlas.view, view)
  assert.equal(gpu.textures.length, 1)
})

test('another resolution makes the atlas again, the profiles resampled to it', () => {
  const gpu = fakeDevice(BACKEND)
  const atlas = createLightProfileAtlas(gpu.device)
  atlas.slots.add('a', profile(0x3c00))
  atlas.sync(256, 32)
  assert.equal(atlas.sync(64, 32), true)
  const [, remade] = gpu.textures
  assert.deepEqual([remade.width, remade.height], [64, 64])
  const write = gpu.textureWrites.at(-1)!
  assert.deepEqual(write.size, [64, 64, 1])
  assert.deepEqual(write.layout, { bytesPerRow: 128, rowsPerImage: 64 })
  assert.equal(write.data.length, 64 * 64)
  assert.ok(
    [...write.data].every((texel) => texel === 0x3c00),
    'a flat profile stays flat',
  )
})

test('a texture handed back is made again by the next sync, the profiles written into it', () => {
  const gpu = fakeDevice(BACKEND)
  const atlas = createLightProfileAtlas(gpu.device)
  atlas.slots.add('a', profile(0x3c00))
  atlas.sync(256, 32)
  atlas.destroy()
  assert.equal(atlas.sync(256, 32), true)
  assert.equal(gpu.textures.length, 2)
  assert.equal(gpu.textureWrites.length, 2)
})
