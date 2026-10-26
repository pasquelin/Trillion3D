import test from 'node:test'
import assert from 'node:assert/strict'
import { destroyRetired } from '../../../gpu/core/frameRetire.ts'
import { createGpuHiz } from './factory.ts'
import { fakeDevice } from '../../../../../../tests/kit/fakeDevice/fakeDevice.ts'

test('a Hi-Z resize replaces the this-frame level-0 depth target', async () => {
  const { device, textures } = fakeDevice()
  const hiz = await createGpuHiz(device, 16, 16)
  assert.ok(hiz)
  const first = hiz.level0
  assert.equal(hiz.resize(device, 32, 32), true)
  assert.notEqual(hiz.level0, first)
  assert.equal(hiz.width, 32)
  assert.equal(hiz.height, 32)
  assert.ok(textures.filter((texture) => texture.format === 'r32float').length >= 2)
  hiz.dispose()
})

test('GPU Hi-Z allocates only the current pyramid and releases it on resize', async () => {
  const { device, buffers, textures, destroyed } = fakeDevice()
  const hiz = await createGpuHiz(device, 16, 16)
  assert.ok(hiz)
  const pyramids = () => textures.filter((texture) => texture.label === 'Trillion3D Hi-Z pyramid')
  assert.equal(pyramids().length, 1)
  const [firstPyramid] = pyramids()
  assert.equal(hiz.resize(device, 32, 32), true)
  assert.ok(!destroyed.includes(firstPyramid), 'the old pyramid lives until the frame is submitted')
  destroyRetired(device)
  assert.ok(destroyed.includes(firstPyramid))
  assert.equal(pyramids().length, 2)
  hiz.dispose()
  assert.ok(buffers.every((buffer) => destroyed.includes(buffer)))
  assert.ok(pyramids().every((pyramid) => destroyed.includes(pyramid)))
})

test('each view keeps its own pyramid: a switch allocates nothing and finds its size back', async () => {
  const { device, textures, destroyed } = fakeDevice()
  const hiz = await createGpuHiz(device, 32, 32)
  assert.ok(hiz)
  const main = hiz.swap(undefined)
  assert.deepEqual([hiz.width, hiz.height], [0, 0], 'a new view is sized by its first frame')
  assert.equal(hiz.resize(device, 16, 8), true)
  assert.equal(destroyed.length, 0, 'the main view’s pyramid is kept aside, whole')
  const made = textures.length
  const side = hiz.swap(main)
  assert.deepEqual([hiz.width, hiz.height], [32, 32])
  assert.equal(hiz.swap(side), main)
  assert.deepEqual([hiz.width, hiz.height], [16, 8])
  assert.equal(textures.length, made, 'no pyramid is made again')
  hiz.swap(main)?.destroy()
  hiz.dispose()
})
