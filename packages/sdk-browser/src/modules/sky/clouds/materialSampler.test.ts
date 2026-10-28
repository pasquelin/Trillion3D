// The one sampler the cloud textures are read through takes the ceiling of the textures that are not
// streamed by tile (`textureMaxAnisotropy`), and is made again, off the frame, when it moves.
import test from 'node:test'
import assert from 'node:assert/strict'
import { cloudSampler } from './textures.ts'
import { createCloudMaterialGpu } from './materialGpu.ts'
import { fakeDevice } from '../../../../../../tests/kit/fakeDevice/fakeDevice.ts'

test('the sampler descriptor takes the ceiling it is made with, and nothing else of it moves', () => {
  const four = cloudSampler(4),
    one = cloudSampler(1)
  assert.equal(four.maxAnisotropy, 4)
  assert.equal(one.maxAnisotropy, 1)
  assert.deepEqual({ ...four, maxAnisotropy: 1 }, one)
})

test('a material makes its sampler at the ceiling and again only when the ceiling moves', () => {
  const { device } = fakeDevice()
  const made: number[] = []
  const create = device.createSampler.bind(device)
  device.createSampler = (descriptor) => {
    made.push(descriptor?.maxAnisotropy ?? 1)
    return create(descriptor)
  }
  const material = createCloudMaterialGpu(device, () => {}, 8)
  assert.deepEqual(made, [8])
  assert.equal(material.setAnisotropy(8), false, 'the same ceiling: nothing made')
  assert.equal(material.setAnisotropy(2), true)
  assert.equal(material.setAnisotropy(2), false)
  assert.deepEqual(made, [8, 2])
  material.dispose()
})
