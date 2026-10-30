// What a planar reflection holds of its mirrored view is committed with the encoder that wrote its image (`./held.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolvePlanarReflection } from '../../../../sdk-core/src/scene/planarReflection/contracts.ts'
import { installGpuGlobals } from '../../../../../tests/kit/fakeDevice/globals.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { commitSubmitted, dropSubmitted } from '../../gpu/core/frameRetire.ts'
import { createPlanarGpu, encodePlanarPrefilter } from './held.ts'
import { planarPlane } from './mirror.ts'
import type { PlanarPipelines } from './pipelines.ts'

const setup = () => {
  installGpuGlobals()
  const { device } = fakeDevice()
  const gpu = device as unknown as GPUDevice
  const planar = createPlanarGpu(gpu)
  const reflection = resolvePlanarReflection({ id: 'lake' })
  const pipelines = {
    prefilter: { get: () => ({}) },
    layouts: { prefilter: {} },
  } as unknown as PlanarPipelines
  const encode = (scale: number) => {
    const encoder = gpu.createCommandEncoder()
    const projection = new Float64Array(16).fill(scale)
    encodePlanarPrefilter(
      gpu,
      encoder,
      pipelines,
      planar,
      reflection,
      planarPlane(reflection),
      { world: new Float64Array(16), projection, near: 0.1 },
      {} as GPUTextureView,
      {} as GPUTextureView,
      [8, 8],
      [8, 8],
    )
    return encoder
  }
  return { planar, encode }
}

test('a submitted encoder commits the image as drawn with the projection it was drawn with', () => {
  const { planar, encode } = setup()
  const encoder = encode(2)
  assert.equal(planar.drawn, false)
  assert.equal(planar.projection[0], 0)
  commitSubmitted(encoder)
  assert.equal(planar.drawn, true)
  assert.equal(planar.projection[0], 2)
})

test('a dropped encoder keeps the previous projection', () => {
  const { planar, encode } = setup()
  commitSubmitted(encode(2))
  dropSubmitted(encode(5))
  assert.equal(planar.projection[0], 2)
})
